document.addEventListener('DOMContentLoaded', function () {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const discussionBtn = document.getElementById('discussionBtn');
    const logDiv = document.getElementById('log');
    const statusDiv = document.getElementById('status');

    function log(msg) {
        const p = document.createElement('div');
        p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        logDiv.appendChild(p);
        logDiv.scrollTop = logDiv.scrollHeight;
    }

    function setRunningState(isRunning) {
        startBtn.disabled = isRunning;
        stopBtn.disabled = !isRunning;
        statusDiv.textContent = isRunning ? "DoHung - 0586255568" : "DoHung - 0586255568";
    }

    startBtn.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab.url.includes("coursera.org")) {
            log("Error: Not on Coursera!");
            return;
        }

        setRunningState(true);
        log("Sending start command...");

        chrome.tabs.sendMessage(tab.id, { action: "START_SKIPPING" }, (response) => {
            if (chrome.runtime.lastError) {
                log("Error: " + chrome.runtime.lastError.message);
                log("Make sure you are on a Coursera page and reload if necessary.");
                setRunningState(false);
            } else {
                log("Started!");
            }
        });
    });

    stopBtn.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Optimistically set to not running, or wait for response? 
        // Let's log first.
        log("Sending stop command...");
        stopBtn.disabled = true; // Prevent double clicks

        chrome.tabs.sendMessage(tab.id, { action: "STOP_SKIPPING" }, (response) => {
            if (chrome.runtime.lastError) {
                log("Error: " + chrome.runtime.lastError.message);
            } else {
                log("Stopped command sent.");
            }
            // We will rely on the content script sending back a message or us processing response to reset state fully if needed
            // But for now, let's reset state here as well for immediate UI feedback if response is "stopped"
            if (response && response.status === "stopped") {
                setRunningState(false);
                statusDiv.textContent = "Stopped";
            }
        });
    });

    discussionBtn.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab.url.includes("coursera.org")) {
            log("Error: Not on Coursera!");
            return;
        }

        log("Sending Auto Discussion command...");
        chrome.tabs.sendMessage(tab.id, { action: "AUTO_DISCUSSION" }, (response) => {
            if (chrome.runtime.lastError) {
                log("Error: " + chrome.runtime.lastError.message);
            } else {
                log("Discussion command sent.");
            }
        });
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "LOG") {
            log(request.message);
        } else if (request.action === "FINISHED") {
            setRunningState(false);
            statusDiv.textContent = "Done";
            log("Process finished.");
        }
    });
});
