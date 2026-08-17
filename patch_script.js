const fs = require('fs');
const path = require('path');

function processDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            processDir(fullPath);
        } else if (fullPath.endsWith('.js')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let newContent = content.replace(
                /([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\._serialized/g,
                '($1._serialized || $1.$$1)',
            );
            if (content !== newContent) {
                fs.writeFileSync(fullPath, newContent);
                console.log('Patched', fullPath);
            }
        }
    }
}
processDir('src');
