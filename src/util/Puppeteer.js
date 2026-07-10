/**
 * Expose a function to the page if it does not exist
 *
 * NOTE:
 * Rewrite it to 'upsertFunction' after updating Puppeteer to 20.6 or higher
 * using page.removeExposedFunction
 * https://pptr.dev/api/puppeteer.page.removeexposedfunction
 *
 * @param {object} page - Puppeteer Page instance
 * @param {string} name - name of function
 * @param {Function} fn - function to expose
 */
async function exposeFunctionIfAbsent(page, name, fn) {
    const exist = await page.evaluate((name) => {
        return !!window[name];
    }, name);
    if (exist) {
        return;
    }
    try {
        await page.exposeFunction(name, fn);
    } catch (e) {
        if (
            e.message &&
            (e.message.includes('already exposed') ||
                e.message.includes('Target closed'))
        ) {
            return;
        }
        throw e;
    }
}

module.exports = { exposeFunctionIfAbsent };
