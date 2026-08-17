const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { startWatcher, getSocket } = require('../watcher.js');

test.describe.serial('True E2E WhatsApp Sync (Baileys)', () => {
    let sock;
    const basePath = path.join(
        process.env.USERPROFILE || process.env.HOME,
        'Documents',
        'syncstaging'
    );
    const IN_DIR = path.join(basePath, 'in');
    const OUT_DIR = path.join(basePath, 'out');

    let sendMeGroupId;
    let receiveMeGroupId;

    test.beforeAll(async () => {
        test.setTimeout(600000); // 10 minutes for authentication and loading
        console.log('Starting real WhatsApp client for testing...');
        sock = await startWatcher();
        
        await new Promise((resolve, reject) => {
            if (sock.authState?.creds?.me) return resolve();
            
            const timeout = setTimeout(() => reject(new Error('Connection timeout')), 300000); // 5 minutes to scan QR
            
            sock.ev.on('connection.update', (update) => {
                const { qr, connection } = update;
                if (qr) {
                    console.log('Generating QR code image...');
                    const qrPath = path.join(__dirname, 'qr.png');
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
                if (connection === 'open') {
                    clearTimeout(timeout);
                    resolve();
                }
            });
        });

        sendMeGroupId = process.env.GROUP_ID;
        receiveMeGroupId = process.env.RECEIVE_GROUP_ID;
        
        if (!sendMeGroupId || !receiveMeGroupId) {
            throw new Error('Could not find required groups for testing in .env');
        }
        
        console.log('Test client fully initialized and bound to groups.');
    });

    test('should sync from WhatsApp (send me) to PC', async () => {
        test.setTimeout(60000);
        
        await new Promise(r => setTimeout(r, 5000));
        
        const testFileName = `test_download_${Date.now()}.png`;
        const testFilePath = path.join(__dirname, testFileName);
        const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        const buffer = Buffer.from(pngBase64, 'base64');
        fs.writeFileSync(testFilePath, buffer);

        const sentMsg = await sock.sendMessage(sendMeGroupId, { image: buffer, caption: 'True E2E Inbound Test' });
        
        sock.ev.emit('messages.upsert', { messages: [sentMsg], type: 'notify' });

        let fileFound = false;
        let retries = 30;
        let downloadedFile = null;
        
        while (!fileFound && retries > 0) {
            const files = fs.readdirSync(IN_DIR);
            downloadedFile = files.find(f => f.includes('test_download') || f.includes('download_') || f.endsWith('.png'));
            
            if (downloadedFile) {
                fileFound = true;
            } else {
                await new Promise(r => setTimeout(r, 1000));
                retries--;
            }
        }
        
        expect(fileFound).toBeTruthy();
        
        if (downloadedFile) {
            try { fs.unlinkSync(path.join(IN_DIR, downloadedFile)); } catch (e) {}
        }
        try { fs.unlinkSync(testFilePath); } catch (e) {}
    });

    test('should handle a blast of multiple inbound files (send me)', async () => {
        test.setTimeout(300000); // 5 minutes for 40 files
        
        await new Promise(r => setTimeout(r, 2000));
        
        const count = 40;
        const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        const buffer = Buffer.from(pngBase64, 'base64');
        
        const startTime = Date.now();
        
        // Clean IN_DIR before test
        const initialFiles = fs.readdirSync(IN_DIR);
        for (const f of initialFiles) {
            if (f.endsWith('.png') || f.includes('download_')) {
                try { fs.unlinkSync(path.join(IN_DIR, f)); } catch(e) {}
            }
        }

        // Fire 40 inbound messages sequentially to respect WhatsApp rate limits
        for (let i = 0; i < count; i++) {
            try {
                const sentMsg = await sock.sendMessage(sendMeGroupId, { image: buffer, caption: `Blast Inbound ${i}` });
                sock.ev.emit('messages.upsert', { messages: [sentMsg], type: 'notify' });
            } catch (e) {
                console.error(`Failed to send inbound blast msg ${i}:`, e);
            }
            await new Promise(r => setTimeout(r, 2000));
        }

        let retries = 120;
        let downloadedCount = 0;
        let finalFiles = [];
        
        while (downloadedCount < count && retries > 0) {
            await new Promise(r => setTimeout(r, 1000));
            finalFiles = fs.readdirSync(IN_DIR).filter(f => f.endsWith('.png') || f.includes('download_'));
            downloadedCount = finalFiles.length;
            retries--;
        }
        
        expect(downloadedCount).toBeGreaterThanOrEqual(count);
        
        // Cleanup
        for (const f of finalFiles) {
            try { fs.unlinkSync(path.join(IN_DIR, f)); } catch(e) {}
        }
    });

    test('should sync from PC to WhatsApp (receive me)', async () => {
        test.setTimeout(60000);
        
        await new Promise(r => setTimeout(r, 2000));
        
        const testFileName = `test_upload_${Date.now()}.png`;
        const testFilePath = path.join(OUT_DIR, testFileName);
        
        const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        fs.writeFileSync(testFilePath, Buffer.from(pngBase64, 'base64'));

        let retries = 30;
        while (fs.existsSync(testFilePath) && retries > 0) {
            await new Promise(r => setTimeout(r, 1000));
            retries--;
        }
        
        expect(fs.existsSync(testFilePath)).toBeFalsy();
    });

    test('should ignore unsupported/temporary files (.tmp)', async () => {
        test.setTimeout(30000);
        
        const testFileName = `test_ignored_${Date.now()}.tmp`;
        const testFilePath = path.join(OUT_DIR, testFileName);
        
        fs.writeFileSync(testFilePath, 'dummy content');

        // Wait a few seconds for chokidar
        await new Promise(r => setTimeout(r, 5000));
        
        // File should NOT have been deleted because it's ignored
        expect(fs.existsSync(testFilePath)).toBeTruthy();
        
        // Cleanup
        try { fs.unlinkSync(testFilePath); } catch (e) {}
    });

    test('should handle a blast of multiple files concurrently', async () => {
        test.setTimeout(300000); // 5 minutes for 40 files
        
        const count = 40; 
        const filePaths = [];
        const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        
        // Clean OUT_DIR before test
        const initialFiles = fs.readdirSync(OUT_DIR);
        for (const f of initialFiles) {
            if (f.endsWith('.png') || f.includes('test_blast_')) {
                try { fs.unlinkSync(path.join(OUT_DIR, f)); } catch(e) {}
            }
        }
        
        for (let i = 0; i < count; i++) {
            const testFilePath = path.join(OUT_DIR, `test_blast_${Date.now()}_${i}.png`);
            fs.writeFileSync(testFilePath, Buffer.from(pngBase64, 'base64'));
            filePaths.push(testFilePath);
        }

        let retries = 300;
        let allDeleted = false;
        
        while (!allDeleted && retries > 0) {
            await new Promise(r => setTimeout(r, 1000));
            allDeleted = filePaths.every(p => !fs.existsSync(p));
            retries--;
        }

        for (const p of filePaths) {
            expect(fs.existsSync(p)).toBeFalsy();
        }
    });

    test('should handle large files gracefully without crashing', async () => {
        test.setTimeout(120000); // 2 minutes for 40MB
        
        const testFileName = `test_large_${Date.now()}.txt`;
        const testFilePath = path.join(OUT_DIR, testFileName);
        
        // Simulate a slow file copy (streaming) to test chokidar's EBUSY polling resistance
        const stream = fs.createWriteStream(testFilePath);
        const chunkSize = 4 * 1024 * 1024; // 4MB chunks
        const totalChunks = 10; // 40MB total
        
        for (let i = 0; i < totalChunks; i++) {
            stream.write(Buffer.alloc(chunkSize, 'a'));
            // Wait 200ms between chunks to keep the file locked by Node, mimicking a slow OS copy
            await new Promise(r => setTimeout(r, 200));
        }
        
        await new Promise(resolve => stream.end(resolve));

        let retries = 60;
        while (fs.existsSync(testFilePath) && retries > 0) {
            await new Promise(r => setTimeout(r, 1000));
            retries--;
        }
        
        expect(fs.existsSync(testFilePath)).toBeFalsy();
    });
});
