const {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const mime = require('mime');
const QRCode = require('qrcode');
require('dotenv').config();

// === GLOBAL ERROR HANDLING ===
process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});

// === DIRECTORY SETUP ===
const basePath = path.join(
    process.env.USERPROFILE || process.env.HOME,
    'Documents',
    'syncstaging'
);
const IN_DIR = path.join(basePath, 'in');
const OUT_DIR = path.join(basePath, 'out');

if (!fs.existsSync(IN_DIR)) fs.mkdirSync(IN_DIR, { recursive: true });
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const sendMeGroupId = process.env.GROUP_ID;
const receiveMeGroupId = process.env.RECEIVE_GROUP_ID;

if (!sendMeGroupId || !receiveMeGroupId) {
    console.error('❌ Error: GROUP_ID or RECEIVE_GROUP_ID is missing from .env');
    process.exit(1);
}

// Global socket reference
let sock;
let outboundPollingInterval = null;

// Graceful shutdown
async function gracefulShutdown() {
    console.log('\n🛑 Shutting down gracefully...');
    if (sock) {
        sock.ev.flush();
    }
    if (outboundPollingInterval) {
        clearInterval(outboundPollingInterval);
    }
    process.exit(0);
}
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// --- HELPER TO EXTRACT MEDIA FROM MESSAGE ---
function getMessageMedia(msg) {
    if (!msg.message) return null;
    const msgType = Object.keys(msg.message)[0];
    if (msgType === 'imageMessage' || msgType === 'videoMessage' || msgType === 'documentMessage' || msgType === 'audioMessage') {
        return { type: msgType, content: msg.message[msgType] };
    }
    if (msgType === 'ephemeralMessage') {
        return getMessageMedia({ message: msg.message.ephemeralMessage.message });
    }
    return null;
}

// --- DELETION QUEUE ---
const deletionQueue = [];
let isProcessingDeletions = false;

// Strict file whitelist for both inbound and outbound
const ALLOWED_EXTENSIONS = new Set([
    // Images
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
    // Documents
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.rtf',
    // Video
    '.mp4', '.avi', '.mov', '.mkv', '.webm',
    // Audio
    '.mp3', '.wav', '.ogg', '.m4a'
]);

function isAllowedFile(filename) {
    if (!filename || filename.startsWith('.')) return false;
    const ext = path.extname(filename).toLowerCase();
    return ALLOWED_EXTENSIONS.has(ext);
}

async function processDeletionQueue() {
    if (isProcessingDeletions) return;
    isProcessingDeletions = true;

    while (deletionQueue.length > 0) {
        const key = deletionQueue.shift();
        try {
            await sock.sendMessage(key.remoteJid, { delete: key });
            console.log('🗑️ Deleted message via queue');
        } catch (err) {
            console.warn('⚠️ Could not delete message via queue:', err.message);
        }
        await new Promise((r) => setTimeout(r, 2000)); // Rate limit buffer
    }

    isProcessingDeletions = false;
}

// --- CORE CONNECTION FUNCTION ---
async function startClient() {
    console.log('⏳ Initializing WhatsApp client (Baileys)...');
    
    // Auth state mapping
    const { state, saveCreds } = await useMultiFileAuthState('.baileys_auth');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }), // Hide noisy Baileys logs
        syncFullHistory: false, // Don't download all old chats to save RAM
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('Generating QR code image...');
            const qrPath = path.join(process.cwd(), 'qr.png');
            QRCode.toFile(
                qrPath,
                qr,
                { errorCorrectionLevel: 'H' },
                (err) => {
                    if (err) console.error('Failed to save QR code image', err);
                    else console.log(`✅ QR Code saved to ${qrPath}! Please scan it.`);
                }
            );
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`❌ Connection closed. Reconnecting: ${shouldReconnect}`, lastDisconnect?.error);
            if (shouldReconnect) {
                startClient();
            } else {
                console.log('❌ You are logged out. Please delete .baileys_auth folder and restart to scan QR code.');
                process.exit(1);
            }
        } else if (connection === 'open') {
            console.log('✅ Client is ready and connected!');
            setupPostConnectionLogic();
        }
    });

    // --- INBOUND SYNC LISTENER ("send me" -> IN_DIR) ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return; // Only process new messages
        
        for (const msg of messages) {
            if (!msg.message) continue;
            
            const chatId = msg.key.remoteJid;
            
            // Only listen to "send me" group
            if (chatId === sendMeGroupId) {
                const mediaData = getMessageMedia(msg);
                
                if (mediaData) {
                    console.log('📩 Detected media in "send me" group. Downloading...');
                    try {
                        // Download the decrypted binary stream
                        const buffer = await downloadMediaMessage(
                            msg,
                            'buffer',
                            {},
                            { 
                                logger: pino({ level: 'silent' }),
                                reuploadRequest: sock.updateMediaMessage
                            }
                        );

                        // Generate a unique filename based on the message ID or timestamp
                        const ext = mime.getExtension(mediaData.content.mimetype || '') || 'bin';
                        
                        if (!isAllowedFile('dummy.' + ext)) {
                            console.log(`⚠️ Ignoring unsupported inbound file type: .${ext}`);
                            // Delete the unsupported message so it doesn't pile up
                            deletionQueue.push(msg.key);
                            processDeletionQueue();
                            return;
                        }

                        if (buffer) {
                            const uniqueId = msg.key.id ? msg.key.id.slice(-5) : Date.now();
                            let baseFilename = mediaData.content.fileName || `download_${uniqueId}.${ext}`;

                            let filePath = path.join(IN_DIR, baseFilename);
                            if (fs.existsSync(filePath)) {
                                filePath = path.join(IN_DIR, `${Date.now()}_${baseFilename}`);
                            }

                            fs.writeFileSync(filePath, buffer);
                            console.log(`✅ Saved file to IN_DIR: ${filePath}`);

                            // Queue message for deletion
                            deletionQueue.push(msg.key);
                            processDeletionQueue();
                        }
                    } catch (err) {
                        console.error('❌ Failed to process incoming media:', err);
                    }
                }
            }
        }
    });
}

const outboundQueue = [];
let isProcessingOutbound = false;

async function processOutboundQueue() {
    if (isProcessingOutbound) return;
    isProcessingOutbound = true;

    while (outboundQueue.length > 0) {
        const { filePath, filename } = outboundQueue.shift();
        if (fs.existsSync(filePath)) {
            await processOutboundFile(filePath, filename);
            // Wait 2 seconds between uploads to strictly avoid WhatsApp rate limits
            await new Promise((r) => setTimeout(r, 2000));
        }
    }

    isProcessingOutbound = false;
}

function isFileLocked(filePath) {
    try {
        // Try to open the file for reading and writing. If it's locked by Windows/Antivirus, this will throw EBUSY/EPERM.
        const fd = fs.openSync(filePath, 'r+');
        fs.closeSync(fd);
        return false;
    } catch (err) {
        return true;
    }
}

function startOutboundPolling() {
    if (outboundPollingInterval) clearInterval(outboundPollingInterval);

    console.log(`📂 Polling OUT_DIR for files: ${OUT_DIR}`);

    outboundPollingInterval = setInterval(() => {
        try {
            const files = fs.readdirSync(OUT_DIR);
            
            for (const file of files) {
                if (!isAllowedFile(file)) {
                    // Delete ignored garbage files that are polluting OUT_DIR
                    try { fs.unlinkSync(path.join(OUT_DIR, file)); } catch(e) {}
                    continue;
                }
                
                const filePath = path.join(OUT_DIR, file);
                
                // Check if the file is already in the queue to avoid duplicates
                const isAlreadyQueued = outboundQueue.some(item => item.filename === file);
                if (isAlreadyQueued) continue;

                // Check if the OS still has the file locked (e.g., still copying, or antivirus scan)
                if (isFileLocked(filePath)) {
                    continue; // Skip it for now, we'll try again in the next tick
                }
                
                console.log(`🔍 Picked up new file for upload: ${file}`);
                outboundQueue.push({ filePath, filename: file });
            }
            
            if (outboundQueue.length > 0) processOutboundQueue();
            
        } catch (error) {
            console.error('⚠️ Error polling OUT_DIR:', error.message);
        }
    }, 3000); // Check every 3 seconds
}

function setupPostConnectionLogic() {
    console.log(`✅ Bound to "send me" group: ${sendMeGroupId}`);
    console.log(`✅ Bound to "receive me" group: ${receiveMeGroupId}`);
    console.log(`📂 Saving to IN_DIR: ${IN_DIR}`);

    startOutboundPolling();
}

// --- OUTBOUND SYNC HANDLER (OUT_DIR -> "receive me") ---
async function processOutboundFile(filePath, filename) {
    try {
        console.log(`📤 Uploading file: ${filename}`);
        const buffer = fs.readFileSync(filePath);
        
        const mimetype = mime.getType(filePath) || 'application/octet-stream';
        
        let messagePayload = {};
        if (mimetype.startsWith('image/')) {
            messagePayload = { image: buffer, caption: filename };
        } else if (mimetype.startsWith('video/')) {
            messagePayload = { video: buffer, caption: filename };
        } else if (mimetype.startsWith('audio/')) {
            messagePayload = { audio: buffer }; // Audio doesn't support captions in the same way, but Baileys handles it
        } else {
            messagePayload = { document: buffer, mimetype: mimetype, fileName: filename };
        }

        // Upload to receive me group
        await sock.sendMessage(receiveMeGroupId, messagePayload);
        console.log(`✅ Uploaded to WhatsApp: ${filename}`);

        // Delete from out folder
        fs.unlinkSync(filePath);
        console.log(`🗑️ Deleted from out folder: ${filename}`);
    } catch (err) {
        console.error(`❌ Failed to upload ${filePath}:`, err);
    }
}

async function startWatcher() {
    await startClient();
    return sock; // Export socket for testing
}

if (require.main === module) {
    startWatcher();
}

module.exports = { startWatcher, getSocket: () => sock };
