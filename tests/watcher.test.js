'use strict';

const chai = require('chai');
const sinon = require('sinon');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const expect = chai.expect;

// Mock the dependencies before requiring watcher.js
const mockClient = new EventEmitter();
mockClient.initialize = sinon.stub();
mockClient.getChats = sinon.stub();
mockClient.getChatById = sinon.stub();
mockClient.sendMessage = sinon.stub();
mockClient.getMessageById = sinon.stub();

// Mock MessageMedia
const mockMessageMedia = {
    fromFilePath: sinon.stub().returns({ data: 'mock-media-data' })
};

const indexModule = require('./index');
sinon.stub(indexModule, 'Client').returns(mockClient);
sinon.stub(indexModule, 'MessageMedia').value(mockMessageMedia);

// Stub FS and Path
const fsStubs = {
    existsSync: sinon.stub(),
    mkdirSync: sinon.stub(),
    writeFileSync: sinon.stub(),
    renameSync: sinon.stub(),
    readFileSync: sinon.stub(),
    readdirSync: sinon.stub(),
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

// Mock Chokidar
const mockFsWatcher = new EventEmitter();
mockFsWatcher.on = mockFsWatcher.on.bind(EventEmitter.prototype);
const chokidarMock = {
    watch: sinon.stub().returns(mockFsWatcher)
};
require.cache[require.resolve('chokidar')] = {
    exports: chokidarMock
};

// Load watcher.js
const watcher = require('../watcher');

describe('Watcher', function () {
    let clock;
    const TARGET_GROUP_ID = '123456789@g.us';
    const GROUP_FOLDER = path.join(__dirname, '../downloads/123456789');

    beforeEach(function () {
        clock = sinon.useFakeTimers();
        process.env.GROUP_ID = TARGET_GROUP_ID;
        fsStubs.existsSync.reset();
        fsStubs.writeFileSync.reset();
        fsStubs.renameSync.reset();
        fsStubs.readdirSync.reset();
        fsStubs.unlinkSync.reset();
        fsStubs.statSync.reset();
        fsStubs.appendFileSync.reset();
        mockClient.sendMessage.reset();
        mockClient.getMessageById.reset();
        mockFsWatcher.removeAllListeners();
        chokidarMock.watch.reset();
    });

    afterEach(function () {
        clock.restore();
    });

    describe('Message Create (Incoming Media)', function () {
        it('should ignore messages from me (Echo Prevention)', async function () {
            const msg = {
                id: { fromMe: true },
                from: TARGET_GROUP_ID,
                to: TARGET_GROUP_ID,
                hasMedia: true
            };
            
            await mockClient.emit('message_create', msg);
            expect(fsStubs.writeFileSync.called).to.be.false;
        });

        it('should download media and use .tmp pattern', async function () {
            const msg = {
                id: { fromMe: false, id: '12345', _serialized: 'msg_12345' },
                from: TARGET_GROUP_ID,
                to: TARGET_GROUP_ID,
                hasMedia: true,
                downloadMedia: sinon.stub().resolves({
                    filename: 'test.png',
                    data: 'base64-data'
                })
            };

            fsStubs.existsSync.withArgs(sinon.match.string).returns(true);

            await mockClient.emit('message_create', msg);

            expect(fsStubs.writeFileSync.calledWith(sinon.match(/\.tmp$/), 'base64-data')).to.be.true;
            expect(fsStubs.renameSync.calledWith(sinon.match(/\.tmp$/), sinon.match(/12345_test\.png$/))).to.be.true;
        });
    });

    describe('Ready Handler & Startup Scan', function () {
        beforeEach(async function () {
            fsStubs.existsSync.withArgs(sinon.match(/downloads/)).returns(true);
            
            const SyncManifest = require('../src/SyncManifest');
            sinon.stub(SyncManifest.prototype, 'set');
            sinon.stub(SyncManifest.prototype, 'has').returns(false);
            sinon.stub(SyncManifest.prototype, 'delete');
            sinon.stub(SyncManifest.prototype, 'entries').returns([]);
            sinon.stub(SyncManifest.prototype, 'getByFilename').returns('msg_id');
            sinon.stub(SyncManifest.prototype, 'getByMessageId').returns('file.png');
        });

        it('should prevent duplicate initialization on multiple ready events', async function () {
            await mockClient.emit('ready');
            await mockClient.emit('ready');

            expect(chokidarMock.watch.calledOnce).to.be.true;
        });

        it('should revoke orphaned messages during startup scan', async function () {
            const SyncManifest = require('../src/SyncManifest');
            SyncManifest.prototype.entries.returns([['missing.png', 'msg_id_123']]);
            fsStubs.existsSync.withArgs(sinon.match(/missing\.png$/)).returns(false);
            
            const mockMsg = { delete: sinon.stub().resolves() };
            mockClient.getMessageById.withArgs('msg_id_123').resolves(mockMsg);

            await mockClient.emit('ready');

            expect(mockMsg.delete.calledWith(true)).to.be.true;
            expect(SyncManifest.prototype.delete.calledWith('missing.png')).to.be.true;
        });

        it('should queue untracked local files for upload during startup scan', async function () {
            fsStubs.readdirSync.returns(['untracked.png', 'sync-manifest.json', 'skipped-files.log', 'tmp.tmp']);
            fsStubs.statSync.returns({ size: 1024 });
            mockClient.sendMessage.resolves({ id: { _serialized: 'sent_id' } });

            await mockClient.emit('ready');
            await clock.tickAsync(3000);

            expect(mockClient.sendMessage.called).to.be.true;
            expect(mockClient.sendMessage.args[0][2].caption).to.equal('untracked.png');
        });

        it('should skip files exceeding MAX_FILE_SIZE_BYTES', async function () {
            fsStubs.readdirSync.returns(['huge.png']);
            fsStubs.statSync.returns({ size: 100 * 1024 * 1024 });

            await mockClient.emit('ready');
            await clock.tickAsync(3000);

            expect(mockClient.sendMessage.called).to.be.false;
            expect(fsStubs.appendFileSync.calledWith(sinon.match(/skipped-files\.log/), sinon.match(/SIZE_SKIP/))).to.be.true;
        });

        it('should enforce rate limit between uploads', async function () {
            fsStubs.readdirSync.returns(['file1.png', 'file2.png']);
            fsStubs.statSync.returns({ size: 1024 });
            mockClient.sendMessage.resolves({ id: { _serialized: 'id' } });

            await mockClient.emit('ready');

            expect(mockClient.sendMessage.calledOnce).to.be.true;
            expect(mockClient.sendMessage.calledTwice).to.be.false;

            await clock.tickAsync(3000);
            expect(mockClient.sendMessage.calledTwice).to.be.true;
        });

        it('should trigger upload on chokidar add event', async function () {
            await mockClient.emit('ready');
            
            fsStubs.existsSync.returns(true);
            fsStubs.statSync.returns({ size: 1024 });
            mockClient.sendMessage.resolves({ id: { _serialized: 'sent_id' } });

            const filePath = path.join(GROUP_FOLDER, 'new_file.png');
            await mockFsWatcher.emit('add', filePath);

            expect(mockClient.sendMessage.called).to.be.true;
            expect(mockClient.sendMessage.args[0][2].caption).to.equal('new_file.png');
        });

        it('should handle local file deletion (chokidar unlink)', async function () {
            const SyncManifest = require('../src/SyncManifest');
            await mockClient.emit('ready');
            
            const mockMsg = { delete: sinon.stub().resolves() };
            mockClient.getMessageById.resolves(mockMsg);

            const filePath = path.join(GROUP_FOLDER, 'deleted.png');
            await mockFsWatcher.emit('unlink', filePath);

            expect(mockMsg.delete.calledWith(true)).to.be.true;
            expect(SyncManifest.prototype.delete.calledWith('deleted.png')).to.be.true;
        });
    });

    describe('WhatsApp Revocations', function () {
        it('should delete local file when message is revoked (everyone)', async function () {
            const SyncManifest = require('../src/SyncManifest');
            SyncManifest.prototype.getByMessageId.withArgs('msg_id_to_revoke').returns('revoked.png');
            
            const msg = { from: TARGET_GROUP_ID, id: { _serialized: 'msg_id_to_revoke' } };
            fsStubs.existsSync.returns(true);

            await mockClient.emit('message_revoke_everyone', msg);

            expect(fsStubs.unlinkSync.calledWith(sinon.match(/revoked\.png$/))).to.be.true;
            expect(SyncManifest.prototype.delete.calledWith('revoked.png')).to.be.true;
        });

        it('should delete local file when message is revoked (me)', async function () {
            const SyncManifest = require('../src/SyncManifest');
            SyncManifest.prototype.getByMessageId.withArgs('msg_id_to_revoke').returns('revoked.png');
            
            const msg = { from: TARGET_GROUP_ID, id: { _serialized: 'msg_id_to_revoke' } };
            fsStubs.existsSync.returns(true);

            await mockClient.emit('message_revoke_me', msg);

            expect(fsStubs.unlinkSync.calledWith(sinon.match(/revoked\.png$/))).to.be.true;
            expect(SyncManifest.prototype.delete.calledWith('revoked.png')).to.be.true;
        });
    });
});
