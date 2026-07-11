const path = require('path');
try {
    const watcherPath = path.join(__dirname, '..', 'watcher.js');
    console.log('Trying to require:', watcherPath);
    require(watcherPath);
    console.log('Successfully required watcher.js');
} catch (e) {
    console.error('Failed to require watcher.js:', e.message);
}
