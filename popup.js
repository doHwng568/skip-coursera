document.addEventListener('DOMContentLoaded', function () {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const discussionBtn = document.getElementById('discussionBtn');
    const gradePeerBtn = document.getElementById('gradePeerBtn');
    const doAssignmentBtn = document.getElementById('doAssignmentBtn');
    const doQuizBtn = document.getElementById('doQuizBtn');
    const aiProviderSelect = document.getElementById('aiProvider');
    const apiKeyInput = document.getElementById('apiKey');
    const logDiv = document.getElementById('log');
    const statusDiv = document.getElementById('status');

    // Load saved AI settings
    chrome.storage.local.get(['aiProvider', 'apiKey'], (result) => {
        if (result.aiProvider) aiProviderSelect.value = result.aiProvider;
        if (result.apiKey) apiKeyInput.value = result.apiKey;
    });

    // Save AI settings on change
    aiProviderSelect.addEventListener('change', () => {
        chrome.storage.local.set({ aiProvider: aiProviderSelect.value });
    });
    apiKeyInput.addEventListener('change', () => {
        chrome.storage.local.set({ apiKey: apiKeyInput.value });
    });

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

    gradePeerBtn.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab.url.includes("coursera.org")) {
            log("Error: Not on Coursera!");
            return;
        }

        const gradeCount = document.getElementById('gradeCount').value || 3;
        log(`Sending Auto Grade Peer command (Count: ${gradeCount})...`);
        chrome.tabs.sendMessage(tab.id, { action: "AUTO_GRADE_PEER", count: parseInt(gradeCount) }, (response) => {
            if (chrome.runtime.lastError) {
                log("Error: " + chrome.runtime.lastError.message);
            } else {
                log("Grade Peer command sent.");
            }
        });
    });

    doAssignmentBtn.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab.url.includes("coursera.org")) {
            log("Error: Not on Coursera!");
            return;
        }

        log("Sending Auto Do Assignment command...");
        chrome.tabs.sendMessage(tab.id, { action: "AUTO_DO_ASSIGNMENT" }, (response) => {
            if (chrome.runtime.lastError) {
                log("Error: " + chrome.runtime.lastError.message);
            } else {
                log("Assignment command sent.");
            }
        });
    });

    doQuizBtn.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab.url.includes("coursera.org")) {
            log("Error: Not on Coursera!");
            return;
        }

        const provider = aiProviderSelect.value;
        const key = apiKeyInput.value;

        if (!key) {
            log("Error: API Key is required for Auto Quiz.");
            return;
        }

        log(`Sending Auto Do Quiz command (${provider})...`);
        chrome.tabs.sendMessage(tab.id, { action: "AUTO_DO_QUIZ", provider: provider, apiKey: key }, (response) => {
            if (chrome.runtime.lastError) {
                log("Error: " + chrome.runtime.lastError.message);
            } else {
                log("Auto Do Quiz command sent. Please wait for the AI...");
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
