const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'test-watch');
if (!fs.existsSync(dir)) fs.mkdirSync(dir);

const watcher = chokidar.watch(dir, {
    ignoreInitial: true,
    awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100,
    }
});

watcher.on('add', p => console.log('added', p));
watcher.on('error', e => console.error('watcher error:', e));

setTimeout(() => {
    console.log('simulating large file write...');
    // In node, we can simulate a large locked write by opening a file and writing slowly.
    const fd = fs.openSync(path.join(dir, 'large.bin'), 'w');
    // Write 70 MB
    const buf = Buffer.alloc(1024 * 1024);
    let written = 0;
    const interval = setInterval(() => {
        fs.writeSync(fd, buf, 0, buf.length, null);
        written++;
        console.log('wrote MB', written);
        if (written > 70) {
            clearInterval(interval);
            fs.closeSync(fd);
            console.log('done writing');
            setTimeout(() => {
                watcher.close();
                process.exit(0);
            }, 3000);
        }
    }, 50); // write 1 MB every 50ms (20 MB/s), takes ~3.5s
}, 1000);
