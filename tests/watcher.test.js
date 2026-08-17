'use strict';

const chai = require('chai');
const sinon = require('sinon');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const proxyquire = require('proxyquire');
const expect = chai.expect;

describe('Watcher', function () {
    let mockClient;
    let mockMessageMedia;
    let chokidarMock;
    let mockFsWatcher;
    let fsStubs;
    let clock;

    beforeEach(function () {
        clock = sinon.useFakeTimers();
        
        mockClient = new EventEmitter();
        mockClient.initialize = sinon.stub();
        mockClient.getChats = sinon.stub().resolves([
            { isGroup: true, name: 'send me', id: { _serialized: 'send_me_id' } },
            { isGroup: true, name: 'receive me', id: { _serialized: 'receive_me_id' } }
        ]);
        mockClient.getChatById = sinon.stub().resolves({
            fetchMessages: sinon.stub().resolves([])
        });
        mockClient.sendMessage = sinon.stub();
        mockClient.getMessageById = sinon.stub();

        mockMessageMedia = {
            fromFilePath: sinon.stub().returns({ data: 'mock-media-data' })
        };

        mockFsWatcher = new EventEmitter();
        mockFsWatcher.on = mockFsWatcher.on.bind(EventEmitter.prototype);
        chokidarMock = {
            watch: sinon.stub().returns(mockFsWatcher)
        };

        fsStubs = {
            existsSync: sinon.stub().returns(true),
            mkdirSync: sinon.stub(),
            writeFileSync: sinon.stub(),
            renameSync: sinon.stub(),
            readFileSync: sinon.stub(),
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

    afterEach(function () {
        clock.restore();
        sinon.restore();
    });

    it('should initialize and watch directories', async function () {
        const watcher = proxyquire('../watcher', {
            'whatsapp-web.js': {
                Client: sinon.stub().returns(mockClient),
                LocalAuth: sinon.stub(),
                MessageMedia: mockMessageMedia
            },
            'chokidar': chokidarMock,
            'fs': fs
        });

        await mockClient.emit('ready');
        // Give async ready handler time to process
        await clock.tickAsync(100);

        expect(mockClient.getChats.calledOnce).to.be.true;
        expect(chokidarMock.watch.calledOnce).to.be.true;
    });
});
