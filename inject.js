// Define the new user agent string by appending the Locking Browser identifiers
const newUserAgent = navigator.userAgent + ' CourseraLockingBrowser/0.6.3 coursera-locking-browser/0.6.3';

// Override navigator.userAgent
Object.defineProperty(navigator, 'userAgent', {
    get: function () { return newUserAgent; }
});

// Override navigator.appVersion
Object.defineProperty(navigator, 'appVersion', {
    get: function () { return newUserAgent; }
});

// Mock the existence of a custom window property that might be checked by the frontend
window.CourseraLockingBrowser = true;
window.courseraLockingBrowser = true;

// --- Bug Fixes for "Launch Error: HTTP 400" and App Launch Loops ---

// 1. Suppress native alerts from Coursera about session transfer errors
const originalAlert = window.alert;
window.alert = function (message) {
    if (typeof message === 'string' && (
        message.includes('transferring your session') || 
        message.includes('400') || 
        message.toLowerCase().includes('launch error')
    )) {
        console.log("[Skipper] Suppressed Locking Browser alert:", message);
        return; // Ignore and don't show to user
    }
    return originalAlert.apply(this, arguments);
};

// 2. Automatically bypass/close HTML modals showing this error
const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
            const bodyText = document.body.innerText || "";
            if (bodyText.includes('transferring your session') || bodyText.includes('HTTP/1.1 400')) {
                // Find OK buttons to click automatically
                const buttons = Array.from(document.querySelectorAll('button'));
                const okButton = buttons.find(b => b.innerText.trim().toUpperCase() === 'OK');
                if (okButton) {
                    console.log("[Skipper] Automatically clicked OK on Launch Error modal.");
                    okButton.click();
                }
            }
        }
    }
});
observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

// 3. Block underlying navigation attempts to launch the physical desktop app
const blockIfCustomProtocol = (url) => {
    if (typeof url === 'string' && (url.includes('coursera-locking-browser') || url.includes('coursera-lock'))) {
        console.log("[Skipper] Blocked custom protocol call to:", url);
        return true;
    }
    return false;
};

// Intercept window.open
const originalOpen = window.open;
window.open = function(url, target, features) {
    if (blockIfCustomProtocol(url)) return null;
    return originalOpen.call(this, url, target, features);
};

// Intercept location.assign & location.replace
const originalAssign = window.location.assign;
window.location.assign = function(url) {
    if (blockIfCustomProtocol(url)) return;
    return originalAssign.call(this, url);
};

const originalReplace = window.location.replace;
window.location.replace = function(url) {
    if (blockIfCustomProtocol(url)) return;
    return originalReplace.call(this, url);
};

// Intercept location.href assignments
const locationHrefDesc = Object.getOwnPropertyDescriptor(window.Location.prototype, 'href');
if (locationHrefDesc && locationHrefDesc.set) {
    const originalHrefSet = locationHrefDesc.set;
    Object.defineProperty(window.Location.prototype, 'href', {
        get: locationHrefDesc.get,
        set: function(url) {
            if (blockIfCustomProtocol(url)) return;
            return originalHrefSet.call(this, url);
        }
    });
}

// Intercept click events on links
document.addEventListener('click', function(e) {
    const target = e.target.closest('a');
    if (target && blockIfCustomProtocol(target.href || target.getAttribute('href'))) {
        e.preventDefault();
        e.stopImmediatePropagation();
        console.log("[Skipper] Blocked click on Locking Browser protocol link.");
    }
}, true); // use capture phase

// Intercept iframe injections
const iframeSrcDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
if (iframeSrcDesc && iframeSrcDesc.set) {
    const originalIframeSet = iframeSrcDesc.set;
    Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
        get: iframeSrcDesc.get,
        set: function(url) {
            if (blockIfCustomProtocol(url)) return;
            return originalIframeSet.call(this, url);
        }
    });
}

// Intercept setAttribute (catches iframe.setAttribute('src', ...) and a.setAttribute('href', ...))
const originalSetAttribute = Element.prototype.setAttribute;
Element.prototype.setAttribute = function(name, value) {
    if ((name.toLowerCase() === 'src' || name.toLowerCase() === 'href') && blockIfCustomProtocol(value)) {
        return;
    }
    return originalSetAttribute.apply(this, arguments);
};

// 4. Fix Watermark Injection ("abc-123") on Copy
// 4a. Stop Coursera from hijacking the Ctrl+C / Cmd+C keydown event perfectly
['keydown', 'keyup', 'keypress'].forEach(evt => {
    window.addEventListener(evt, function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === 'c') {
            e.stopPropagation(); // CRITICAL: Stop propagation down the tree
            e.stopImmediatePropagation();
            // Do NOT preventDefault, letting the browser native copy proceed
            console.log(`[Skipper] Intercepted Ctrl+C ${evt}, blocking potential watermark script.`);
        }
    }, true); // highest priority
});

// A robust cleaner to strip DOM-injected hidden watermarks using live DOM computed styles
function getCleanSelectionText(context = "") {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
        return "";
    }
    
    let text = sel.toString();
    
    try {
        const range = sel.getRangeAt(0);
        let root = range.commonAncestorContainer;
        if (root.nodeType !== Node.ELEMENT_NODE) {
            root = root.parentNode;
        }
        
        // Find all elements within the ancestor
        if (root && root.querySelectorAll) {
            const elements = root.querySelectorAll('*');
            let hiddenTexts = [];
            
            for (let i = 0; i < elements.length; i++) {
                let el = elements[i];
                if (sel.containsNode(el, true)) {
                    const style = window.getComputedStyle(el);
                    const isHidden = 
                        style.opacity === '0' ||
                        style.visibility === 'hidden' ||
                        style.display === 'none' ||
                        parseFloat(style.width) === 0 ||
                        parseFloat(style.height) === 0 ||
                        parseFloat(style.fontSize) === 0 ||
                        style.color === 'transparent' ||
                        style.color === 'rgba(0, 0, 0, 0)' ||
                        (style.position === 'absolute' && parseFloat(style.left) < -900) ||
                        (style.position === 'absolute' && parseFloat(style.top) < -900) ||
                        (style.clip && style.clip !== 'auto' && style.clip !== 'none') ||
                        (style.clipPath && style.clipPath !== 'none') ||
                        el.getAttribute('aria-hidden') === 'true'; // also check aria-hidden
                    
                    if (isHidden) {
                        const elText = (el.innerText || el.textContent || "").trim();
                        if (elText.length > 0) {
                            hiddenTexts.push(elText);
                        }
                    }
                }
            }
            
            // Sort by length descending, so we replace larger chunks first to prevent partial overlaps
            hiddenTexts.sort((a, b) => b.length - a.length);
            
            for (let ht of hiddenTexts) {
                if (text.includes(ht)) {
                    text = text.replace(ht, '');
                } else {
                    // Try stripping spaces if exact match fails
                    const regex = new RegExp(ht.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'g');
                    text = text.replace(regex, '');
                }
            }
        }
    } catch (err) {
        console.error(`[Skipper] Error while cleaning text:`, err);
    }
    
    // Explicitly strip known Coursera static watermark artifacts that might evade DOM detection
    text = text.replace(/Do you understand\?/gi, '');
    
    // Clean up any stray double blank lines created by removing the watermarks
    text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
    text = text.trim();
    
    return text;
}

// 4b. Stop the 'copy' event from reaching their scripts
window.addEventListener('copy', function(e) {
    const selection = getCleanSelectionText("CopyEvent");
    if (selection) {
        e.clipboardData.setData('text/plain', selection);
        e.preventDefault();
        e.stopPropagation(); // Stop propagation to body/document
        e.stopImmediatePropagation();
        console.log("[Skipper] Cleaned clipboard content at window level.");
    }
}, true); // highest priority

// 4c. Blackhole programmatically writing bad text to clipboard
if (navigator.clipboard) {
    const origWriteText = navigator.clipboard.writeText;
    navigator.clipboard.writeText = async function(text) {
        let selectionStr = getCleanSelectionText("writeText");
        return origWriteText.call(this, selectionStr || text);
    };
    
    const origWrite = navigator.clipboard.write;
    navigator.clipboard.write = async function(data) {
        let selectionStr = getCleanSelectionText("write");
        if (selectionStr) {
             return origWriteText.call(navigator.clipboard, selectionStr);
        }
        return origWrite.call(this, data);
    };
}

// Override legacy execCommand copy
const origExecCommand = document.execCommand;
document.execCommand = function(commandId, showUI, value) {
    if (commandId && commandId.toLowerCase() === 'copy') {
        // We let the natural copy override handle it if possible.
        // Return true to pretend it worked.
        return true; 
    }
    return origExecCommand.apply(this, arguments);
};

// Intercept cut as well
window.addEventListener('cut', function(e) {
    e.stopPropagation();
    e.stopImmediatePropagation();
}, true);

console.log("[Skipper] Injected Coursera Locking Browser bypass layer. User agent is now spoofed, deep-links are blocked, and clipboard is fully protected.");
