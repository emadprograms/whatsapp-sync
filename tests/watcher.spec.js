const { test, expect } = require('@playwright/test');
const sinon = require('sinon');
const fs = require('fs');
const EventEmitter = require('events');
const { startWatcher } = require('../watcher.js');

test.describe('Watcher E2E Flows', () => {
    let mockClient;
    let mockMessageMedia;
    let chokidarMock;
    let mockFsWatcher;
    let fsStubs;
    let clock;

    test.beforeEach(() => {
        clock = sinon.useFakeTimers({ shouldClearNativeTimers: true });

        mockClient = new EventEmitter();
        mockClient.initialize = sinon.stub().resolves();
        mockClient.getChats = sinon.stub().resolves([
            { isGroup: true, name: 'send me', id: { _serialized: 'send_me_id' } },
            { isGroup: true, name: 'receive me', id: { _serialized: 'receive_me_id' } }
        ]);
        
        mockClient.getChatById = sinon.stub().resolves({
            fetchMessages: sinon.stub().resolves([])
        });
        mockClient.sendMessage = sinon.stub().resolves();
        mockClient.getMessageById = sinon.stub().resolves({
            delete: sinon.stub().resolves()
        });

        mockMessageMedia = {
            fromFilePath: sinon.stub().returns({ data: 'mock-media-data' })
        };

        mockFsWatcher = new EventEmitter();
        chokidarMock = {
            watch: sinon.stub().returns(mockFsWatcher)
        };

        fsStubs = {
            existsSync: sinon.stub().returns(true),
            mkdirSync: sinon.stub(),
            writeFileSync: sinon.stub(),
            renameSync: sinon.stub(),
            readFileSync: sinon.stub().returns(''),
            readdirSync: sinon.stub().returns([]),
            unlinkSync: sinon.stub(),
            statSync: sinon.stub(),
            appendFileSync: sinon.stub(),
        };

        sinon.stub(fs, 'existsSync').callsFake(fsStubs.existsSync);
        sinon.stub(fs, 'mkdirSync').callsFake(fsStubs.mkdirSync);
        sinon.stub(fs, 'writeFileSync').callsFake(fsStubs.writeFileSync);
        sinon.stub(fs, 'renameSync').callsFake(fsStubs.renameSync);
        sinon.stub(fs, 'readFileSync').callsFake(fsStubs.readFileSync);
        sinon.stub(fs, 'readdirSync').callsFake(fsStubs.readdirSync);
        sinon.stub(fs, 'unlinkSync').callsFake(fsStubs.unlinkSync);
        sinon.stub(fs, 'statSync').callsFake(fsStubs.statSync);
        sinon.stub(fs, 'appendFileSync').callsFake(fsStubs.appendFileSync);

    });

    test.afterEach(() => {
        clock.restore();
        sinon.restore();
    });

    test('should download incoming files to in folder and delete from WhatsApp', async () => {
        const watcher = await startWatcher({
            whatsapp: {
                Client: sinon.stub().returns(mockClient),
                LocalAuth: sinon.stub(),
                MessageMedia: mockMessageMedia
            },
            chokidar: chokidarMock,
            fs: fs
        });

        await mockClient.emit('ready');
        await clock.tickAsync(100);

        // Simulate incoming message with media
        const mockMsg = {
            from: 'send_me_id',
            to: 'send_me_id',
            hasMedia: true,
            downloadMedia: sinon.stub().resolves({
                mimetype: 'image/jpeg',
                filename: 'test_image.jpg',
                data: 'base64data'
            }),
            id: { _serialized: 'msg_123', id: 'msg_123' }
        };

        await mockClient.emit('message_create', mockMsg);
        await clock.tickAsync(100);

        // Verify file was written to in folder
        expect(fsStubs.writeFileSync.calledOnce).toBeTruthy();
        expect(fsStubs.writeFileSync.firstCall.args[0]).toMatch(/test_image\.jpg$/);

        // Advance time to allow deletion queue to process
        await clock.tickAsync(3000);

        // Verify message was deleted
        expect(mockClient.getMessageById.calledWith('msg_123')).toBeTruthy();
    });

    test('should monitor out folder and upload files to WhatsApp, then delete locally', async () => {
        const watcher = await startWatcher({
            whatsapp: {
                Client: sinon.stub().returns(mockClient),
                LocalAuth: sinon.stub(),
                MessageMedia: mockMessageMedia
            },
            chokidar: chokidarMock,
            fs: fs
        });

        await mockClient.emit('ready');
        await clock.tickAsync(100);

        // Simulate file added to out directory
        await mockFsWatcher.emit('add', '/fake/path/out/new_upload.jpg');
        await clock.tickAsync(100);

        // Verify upload
        expect(mockClient.sendMessage.calledOnce).toBeTruthy();
        expect(mockClient.sendMessage.firstCall.args[0]).toBe('receive_me_id');

        // Verify local deletion
        expect(fsStubs.unlinkSync.calledOnce).toBeTruthy();
        expect(fsStubs.unlinkSync.firstCall.args[0]).toBe('/fake/path/out/new_upload.jpg');
    });
});
