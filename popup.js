document.addEventListener('DOMContentLoaded', function () {
    const startBtn = document.getElementById('startBtn');
    const logDiv = document.getElementById('log');
    const statusDiv = document.getElementById('status');

    function log(msg) {
        const p = document.createElement('div');
        p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        logDiv.appendChild(p);
        logDiv.scrollTop = logDiv.scrollHeight;
    }

    startBtn.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab.url.includes("coursera.org")) {
            log("Error: Not on Coursera!");
            return;
        }

        startBtn.disabled = true;
        statusDiv.textContent = "Running...";
        log("Sending start command...");

        chrome.tabs.sendMessage(tab.id, { action: "START_SKIPPING" }, (response) => {
            if (chrome.runtime.lastError) {
                log("Error: " + chrome.runtime.lastError.message);
                log("Make sure you are on a Coursera page and reload if necessary.");
                startBtn.disabled = false;
            } else {
                log("Started!");
            }
        });
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "LOG") {
            log(request.message);
        } else if (request.action === "FINISHED") {
            statusDiv.textContent = "Done";
            startBtn.disabled = false;
            log("Process finished.");
        }
    });
});
