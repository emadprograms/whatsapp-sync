'use strict';

const fs = require('fs');

/**
 * A thin JSON-backed key-value store that maps filenames to WhatsApp message IDs.
 */
class SyncManifest {
    /**
     * @param {string} manifestPath - The path to the manifest JSON file
     */
    constructor(manifestPath) {
        this.manifestPath = manifestPath;
        this._data = {};
        this._load();
    }

    _load() {
        const tmpPath = this.manifestPath + '.tmp';

        if (fs.existsSync(tmpPath)) {
            fs.unlinkSync(tmpPath);
        }

        let raw;
        let parsed;

        try {
            raw = fs.readFileSync(this.manifestPath, 'utf8');
            parsed = JSON.parse(raw);
        } catch (err) {
            if (err.code === 'ENOENT') {
                this._data = {};
                return;
            } else {
                throw new Error(
                    `SyncManifest: failed to parse ${this.manifestPath}: ${err.message}`,
                );
            }
        }

        if (
            typeof parsed !== 'object' ||
            parsed === null ||
            Array.isArray(parsed)
        ) {
            throw new Error(
                `SyncManifest: failed to parse ${this.manifestPath}: Invalid format`,
            );
        }

        this._data = parsed;
    }

    _save() {
        const json = JSON.stringify(this._data, null, 2);
        const tmpPath = this.manifestPath + '.tmp';

        fs.writeFileSync(tmpPath, json, 'utf8');
        fs.renameSync(tmpPath, this.manifestPath);
    }

    set(filename, messageId) {
        this._data[filename] = messageId;
        this._save();
    }

    has(filename) {
        return Object.prototype.hasOwnProperty.call(this._data, filename);
    }

    getByFilename(filename) {
        return this._data[filename];
    }

    getByMessageId(messageId) {
        for (const [key, value] of Object.entries(this._data)) {
            if (value === messageId) {
                return key;
            }
        }
        return undefined;
    }

    delete(filename) {
        delete this._data[filename];
        this._save();
    }

    entries() {
        return Object.entries(this._data);
    }
}

module.exports = SyncManifest;
