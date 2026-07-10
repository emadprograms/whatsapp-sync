'use strict';

const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SyncManifest = require('../src/SyncManifest');

describe('SyncManifest', function () {
    let testDir;
    let manifestPath;

    beforeEach(function () {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-manifest-test-'));
        manifestPath = path.join(testDir, 'sync-manifest.json');
    });

    afterEach(function () {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('creates empty manifest when file does not exist', function () {
        const manifest = new SyncManifest(manifestPath);
        expect(manifest.entries()).to.deep.equal([]);
    });

    it('loads existing manifest data from disk on construction', function () {
        const data = { 'foo.jpg': 'id_abc' };
        fs.writeFileSync(manifestPath, JSON.stringify(data), 'utf8');

        const manifest = new SyncManifest(manifestPath);
        expect(manifest.getByFilename('foo.jpg')).to.equal('id_abc');
    });

    it('set() persists entry to disk', function () {
        const manifest = new SyncManifest(manifestPath);
        manifest.set('bar.mp4', 'id_xyz');

        const diskData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        expect(diskData['bar.mp4']).to.equal('id_xyz');
    });

    it('has() returns true after set(), false for unknown key', function () {
        const manifest = new SyncManifest(manifestPath);
        manifest.set('img.png', 'id_111');

        expect(manifest.has('img.png')).to.be.true;
        expect(manifest.has('nope.txt')).to.be.false;
    });

    it('getByFilename() returns the messageId for a known filename', function () {
        const manifest = new SyncManifest(manifestPath);
        manifest.set('vid.mp4', 'id_999');

        expect(manifest.getByFilename('vid.mp4')).to.equal('id_999');
    });

    it('getByFilename() returns undefined for unknown filename', function () {
        const manifest = new SyncManifest(manifestPath);
        expect(manifest.getByFilename('ghost.jpg')).to.be.undefined;
    });

    it('getByMessageId() returns the filename for a known messageId (reverse lookup)', function () {
        const manifest = new SyncManifest(manifestPath);
        manifest.set('audio.ogg', 'id_rev_1');

        expect(manifest.getByMessageId('id_rev_1')).to.equal('audio.ogg');
    });

    it('getByMessageId() returns undefined for unknown messageId', function () {
        const manifest = new SyncManifest(manifestPath);
        expect(manifest.getByMessageId('no_such_id')).to.be.undefined;
    });

    it('delete() removes the entry and persists to disk', function () {
        const manifest = new SyncManifest(manifestPath);
        manifest.set('to_delete.jpg', 'id_del');

        manifest.delete('to_delete.jpg');
        expect(manifest.has('to_delete.jpg')).to.be.false;

        const diskData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        expect(diskData).to.not.have.property('to_delete.jpg');
    });

    it('_load() cleans up a stale .tmp file on construction', function () {
        const tmpPath = manifestPath + '.tmp';
        fs.writeFileSync(tmpPath, 'stale content', 'utf8');

        new SyncManifest(manifestPath);
        expect(fs.existsSync(tmpPath)).to.be.false;
    });

    it('_load() throws a descriptive error on malformed JSON', function () {
        fs.writeFileSync(manifestPath, 'not valid json {{{', 'utf8');

        expect(() => new SyncManifest(manifestPath)).to.throw(
            /SyncManifest: failed to parse/,
        );
    });

    it('set() + restart: data survives re-instantiation', function () {
        const manifest = new SyncManifest(manifestPath);
        manifest.set('persist.jpg', 'id_persist');

        const manifest2 = new SyncManifest(manifestPath);
        expect(manifest2.getByFilename('persist.jpg')).to.equal('id_persist');
    });

    it('entries() returns all [filename, messageId] pairs', function () {
        const manifest = new SyncManifest(manifestPath);
        manifest.set('a.jpg', 'id_a');
        manifest.set('b.jpg', 'id_b');

        const e = manifest.entries();
        expect(e).to.have.length(2);
        expect(e.map((p) => p[0])).to.include.members(['a.jpg', 'b.jpg']);
    });
});
