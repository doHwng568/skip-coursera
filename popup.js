document.addEventListener('DOMContentLoaded', function () {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const discussionBtn = document.getElementById('discussionBtn');
    const gradePeerBtn = document.getElementById('gradePeerBtn');
    const doAssignmentBtn = document.getElementById('doAssignmentBtn');
    const logDiv = document.getElementById('log');
    const statusDiv = document.getElementById('status');

    // ChatGPT Quiz Assistant elements
    const qaTargetTabBadge = document.getElementById('qaTargetTabBadge');
    const qaCopyJsonBtn = document.getElementById('qaCopyJsonBtn');
    const qaOpenChatGptBtn = document.getElementById('qaOpenChatGptBtn');
    const qaExtractStatus = document.getElementById('qaExtractStatus');
    const qaPromptFallbackContainer = document.getElementById('qaPromptFallbackContainer');
    const qaPromptFallbackText = document.getElementById('qaPromptFallbackText');
    const qaResponseJsonInput = document.getElementById('qaResponseJsonInput');
    const qaValidateBtn = document.getElementById('qaValidateBtn');
    const qaValidationSummary = document.getElementById('qaValidationSummary');
    const qaPreviewContainer = document.getElementById('qaPreviewContainer');
    const qaApplyBtn = document.getElementById('qaApplyBtn');
    const qaAlert = document.getElementById('qaAlert');

    let currentValidatedPayload = null;

    // Session storage helper with fallback to local storage
    const sessionStore = (chrome.storage && chrome.storage.session) ? chrome.storage.session : chrome.storage.local;

    function getSavedCourseraTabInfo() {
        return new Promise((resolve) => {
            sessionStore.get(['courseraTabId', 'snapshotId'], (res) => {
                resolve(res || {});
            });
        });
    }

    function saveCourseraTabInfo(tabId, snapshotId) {
        return new Promise((resolve) => {
            const data = { courseraTabId: tabId };
            if (snapshotId) data.snapshotId = snapshotId;
            sessionStore.set(data, () => {
                resolve();
            });
        });
    }

    async function resolveCourseraTab() {
        // 1. Check active tab in current window
        try {
            const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (activeTab && activeTab.url && activeTab.url.includes("coursera.org")) {
                await saveCourseraTabInfo(activeTab.id);
                return { tab: activeTab, isActive: true };
            }
        } catch (e) { }

        // 2. Check saved session tab
        const saved = await getSavedCourseraTabInfo();
        if (saved.courseraTabId) {
            try {
                const savedTab = await chrome.tabs.get(saved.courseraTabId);
                if (savedTab && savedTab.url && savedTab.url.includes("coursera.org")) {
                    return { tab: savedTab, isActive: false };
                }
            } catch (e) {
                // Saved tab is closed or invalid
            }
        }

        // 3. Fallback: check all open tabs for any Coursera tab
        try {
            const courseraTabs = await chrome.tabs.query({ url: "*://*.coursera.org/*" });
            if (courseraTabs && courseraTabs.length > 0) {
                const found = courseraTabs[0];
                await saveCourseraTabInfo(found.id);
                return { tab: found, isActive: false };
            }
        } catch (e) { }

        return { tab: null, isActive: false };
    }

    async function updateTabBadge() {
        if (!qaTargetTabBadge) return null;
        const { tab, isActive } = await resolveCourseraTab();
        if (tab) {
            qaTargetTabBadge.textContent = isActive ? "Coursera (Active)" : `Coursera (Tab #${tab.id})`;
            qaTargetTabBadge.style.background = "#e6f7f2";
            qaTargetTabBadge.style.color = "#10a37f";
            qaTargetTabBadge.style.borderColor = "#10a37f";
        } else {
            qaTargetTabBadge.textContent = "No Coursera Tab";
            qaTargetTabBadge.style.background = "#fbeae8";
            qaTargetTabBadge.style.color = "#c0392b";
            qaTargetTabBadge.style.borderColor = "#e74c3c";
        }
        return tab;
    }

    function showQaAlert(message, type = 'error') {
        if (!qaAlert) return;
        qaAlert.style.display = 'block';
        qaAlert.textContent = message;
        if (type === 'error') {
            qaAlert.style.background = '#fde8e8';
            qaAlert.style.color = '#9b1c1c';
            qaAlert.style.border = '1px solid #f8b4b4';
        } else if (type === 'success') {
            qaAlert.style.background = '#def7ec';
            qaAlert.style.color = '#03543f';
            qaAlert.style.border = '1px solid #84e1bc';
        } else if (type === 'warning') {
            qaAlert.style.background = '#fef08a';
            qaAlert.style.color = '#713f12';
            qaAlert.style.border = '1px solid #fde047';
        }
    }

    function clearQaAlert() {
        if (!qaAlert) return;
        qaAlert.style.display = 'none';
        qaAlert.textContent = '';
    }

    function renderPreviews(previews) {
        if (!qaPreviewContainer) return;
        qaPreviewContainer.innerHTML = '';
        qaPreviewContainer.style.display = 'block';

        previews.forEach((p) => {
            const item = document.createElement('div');
            item.className = 'qa-preview-item';

            const header = document.createElement('div');
            header.style.display = 'flex';
            header.style.justifyContent = 'space-between';
            header.style.alignItems = 'center';
            header.style.marginBottom = '4px';

            const qIdSpan = document.createElement('span');
            qIdSpan.style.fontWeight = 'bold';
            qIdSpan.textContent = p.questionId + ` (${p.selectionMode === 'single' ? 'Single' : 'Multi'})`;
            header.appendChild(qIdSpan);

            const badge = document.createElement('span');
            badge.className = 'qa-badge ' + (
                p.status === 'answered' ? 'badge-answered' :
                p.status === 'uncertain' ? 'badge-uncertain' :
                p.status === 'missing' ? 'badge-missing' : 'badge-invalid'
            );
            badge.textContent = p.status.toUpperCase();
            header.appendChild(badge);
            item.appendChild(header);

            // Question text (safely inserted via textContent)
            const qText = document.createElement('div');
            qText.style.color = '#333';
            qText.style.marginBottom = '4px';
            const displayQuestion = p.questionText && p.questionText.length > 90 ? p.questionText.substring(0, 90) + '...' : (p.questionText || '');
            qText.textContent = displayQuestion;
            item.appendChild(qText);

            // Options or Error (safely inserted via textContent)
            if (p.error) {
                const errDiv = document.createElement('div');
                errDiv.style.color = '#c0392b';
                errDiv.style.fontWeight = '500';
                errDiv.textContent = 'Error: ' + p.error;
                item.appendChild(errDiv);
            } else if (p.selectedOptionTexts && p.selectedOptionTexts.length > 0) {
                const optDiv = document.createElement('div');
                optDiv.style.color = '#27ae60';
                optDiv.style.fontWeight = '600';
                optDiv.textContent = 'Selected: ' + p.selectedOptionTexts.join(', ');
                item.appendChild(optDiv);
            } else if (p.status === 'uncertain') {
                const uncDiv = document.createElement('div');
                uncDiv.style.color = '#d35400';
                uncDiv.style.fontStyle = 'italic';
                uncDiv.textContent = 'Uncertain: will be skipped.';
                item.appendChild(uncDiv);
            }

            // Reason / Confidence (safely inserted via textContent)
            if (p.reason) {
                const reasonDiv = document.createElement('div');
                reasonDiv.style.color = '#7f8c8d';
                reasonDiv.style.fontSize = '10px';
                reasonDiv.style.marginTop = '2px';
                reasonDiv.textContent = `Confidence: ${p.confidence || 'n/a'} | ${p.reason}`;
                item.appendChild(reasonDiv);
            }

            qaPreviewContainer.appendChild(item);
        });
    }

    // Initialize tab badge
    updateTabBadge();

    // Execute Quiz Assistant methods directly on tab using chrome.scripting API
    // Bypasses chrome.tabs.sendMessage to completely prevent "message channel closed" listener issues
    async function executeQuizAssistant(tabId, method, ...args) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ["quiz-assistant.js"]
            });
        } catch (injectErr) {
            console.warn("[Skipper] Injection note:", injectErr);
        }

        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: (methodName, methodArgs) => {
                    try {
                        const assistant = window.courseraQuizAssistant || (typeof CourseraQuizAssistant !== 'undefined' ? new CourseraQuizAssistant() : null);
                        if (!assistant) {
                            return { success: false, error: "Quiz Assistant module could not be initialized on Coursera." };
                        }
                        window.courseraQuizAssistant = assistant;
                        if (methodName === 'exportQuiz') {
                            return assistant.exportQuiz();
                        } else if (methodName === 'validateAnswers') {
                            return assistant.validateAnswers(methodArgs[0], methodArgs[1]);
                        } else if (methodName === 'applyAnswers') {
                            return assistant.applyAnswers(methodArgs[0], methodArgs[1]);
                        }
                        return { success: false, error: "Unknown method: " + methodName };
                    } catch (err) {
                        return { success: false, error: err.message || String(err) };
                    }
                },
                args: [method, args]
            });

            if (results && results[0] && results[0].result !== undefined) {
                return results[0].result;
            }
            return { success: false, error: "No response from Coursera page." };
        } catch (execErr) {
            console.error("[Skipper] executeQuizAssistant error:", execErr);
            return { success: false, error: execErr.message || String(execErr) };
        }
    }

    // ChatGPT Quiz Assistant Event Handlers
    if (qaCopyJsonBtn) {
        qaCopyJsonBtn.addEventListener('click', async () => {
            clearQaAlert();
            const tab = await updateTabBadge();
            if (!tab) {
                showQaAlert("No Coursera quiz tab found. Please open a Coursera quiz tab first.");
                return;
            }

            qaCopyJsonBtn.disabled = true;
            qaCopyJsonBtn.textContent = "Extracting...";
            if (qaExtractStatus) {
                qaExtractStatus.textContent = "Scanning quiz questions...";
                qaExtractStatus.style.color = "#555";
            }

            const response = await executeQuizAssistant(tab.id, 'exportQuiz');
            qaCopyJsonBtn.disabled = false;
            qaCopyJsonBtn.textContent = "Copy Quiz JSON";

            if (!response || !response.success) {
                showQaAlert(response && response.error ? response.error : "Failed to extract quiz questions.");
                return;
            }

            const jsonStr = JSON.stringify(response.payload, null, 2);
            await saveCourseraTabInfo(tab.id, response.snapshotId);

            try {
                await navigator.clipboard.writeText(jsonStr);
                if (qaExtractStatus) {
                    qaExtractStatus.textContent = `Copied ${response.questionCount} questions to clipboard! (${response.unsupportedCount || 0} unsupported skipped)`;
                    qaExtractStatus.style.color = "#27ae60";
                }
                if (qaPromptFallbackContainer) qaPromptFallbackContainer.style.display = "none";
            } catch (clipErr) {
                if (qaExtractStatus) {
                    qaExtractStatus.textContent = `Found ${response.questionCount} questions. Copy manually below:`;
                    qaExtractStatus.style.color = "#d35400";
                }
                if (qaPromptFallbackContainer && qaPromptFallbackText) {
                    qaPromptFallbackContainer.style.display = "block";
                    qaPromptFallbackText.value = jsonStr;
                    qaPromptFallbackText.focus();
                    qaPromptFallbackText.select();
                }
            }
        });
    }

    if (qaOpenChatGptBtn) {
        qaOpenChatGptBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: "https://chatgpt.com/" });
        });
    }

    if (qaValidateBtn) {
        qaValidateBtn.addEventListener('click', async () => {
            clearQaAlert();
            if (qaValidationSummary) qaValidationSummary.style.display = 'none';
            if (qaPreviewContainer) qaPreviewContainer.style.display = 'none';
            if (qaApplyBtn) qaApplyBtn.disabled = true;
            currentValidatedPayload = null;

            const rawInput = qaResponseJsonInput ? qaResponseJsonInput.value.trim() : "";
            if (!rawInput) {
                showQaAlert("Please paste the ChatGPT JSON response into the text area.");
                return;
            }

            // Clean markdown code fences if present
            let cleaned = rawInput;
            if (cleaned.startsWith('```')) {
                cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
            }

            let parsed;
            try {
                parsed = JSON.parse(cleaned);
            } catch (e) {
                showQaAlert("JSON Syntax Error: " + e.message + ". Please ensure ChatGPT returned valid JSON.");
                return;
            }

            if (!parsed || typeof parsed !== 'object') {
                showQaAlert("Invalid JSON structure: Root must be a JSON object.");
                return;
            }

            const tab = await updateTabBadge();
            if (!tab) {
                showQaAlert("Target Coursera tab is not available. Please ensure Coursera quiz tab is open.");
                return;
            }

            const saved = await getSavedCourseraTabInfo();
            const snapshotId = parsed.snapshotId || saved.snapshotId;

            if (!snapshotId) {
                showQaAlert("Missing snapshotId in JSON. Please make sure the JSON preserves snapshotId.");
                return;
            }

            const answers = parsed.answers || parsed;

            qaValidateBtn.disabled = true;
            qaValidateBtn.textContent = "Validating...";

            const response = await executeQuizAssistant(tab.id, 'validateAnswers', snapshotId, answers);

            qaValidateBtn.disabled = false;
            qaValidateBtn.textContent = "Validate & Preview";

            if (!response) {
                showQaAlert("No response received from Coursera page.");
                return;
            }

            if (response.error) {
                showQaAlert(response.error);
                return;
            }

            // Render preview items safely
            if (response.previews && response.previews.length > 0) {
                renderPreviews(response.previews);
            }

            // Show validation summary
            if (qaValidationSummary) {
                qaValidationSummary.style.display = 'block';
                const sum = response.summary || { validAnswersCount: 0, uncertainCount: 0, missingCount: 0, invalidCount: 0 };
                if (response.valid && sum.validAnswersCount > 0) {
                    qaValidationSummary.style.background = '#d4edda';
                    qaValidationSummary.style.color = '#155724';
                    qaValidationSummary.style.border = '1px solid #c3e6cb';
                    qaValidationSummary.textContent = `✓ Valid: ${sum.validAnswersCount} questions ready to apply (${sum.uncertainCount} uncertain, ${sum.missingCount} omitted).`;
                    
                    if (qaApplyBtn) qaApplyBtn.disabled = false;
                    currentValidatedPayload = {
                        snapshotId: response.snapshotId,
                        answers: answers
                    };
                } else {
                    qaValidationSummary.style.background = '#f8d7da';
                    qaValidationSummary.style.color = '#721c24';
                    qaValidationSummary.style.border = '1px solid #f5c6cb';
                    qaValidationSummary.textContent = `✗ Cannot apply: ${sum.invalidCount} invalid, ${sum.validAnswersCount} valid, ${sum.uncertainCount} uncertain.`;

                    if (response.errors && response.errors.length > 0) {
                        showQaAlert(response.errors.join(' | '));
                    }
                }
            }
        });
    }

    if (qaApplyBtn) {
        qaApplyBtn.addEventListener('click', async () => {
            clearQaAlert();
            if (!currentValidatedPayload) {
                showQaAlert("Please validate the answers first before applying.");
                return;
            }

            const tab = await updateTabBadge();
            if (!tab) {
                showQaAlert("Coursera tab is not available. Please reopen the quiz tab.");
                return;
            }

            qaApplyBtn.disabled = true;
            qaApplyBtn.textContent = "Applying Choices...";

            const response = await executeQuizAssistant(tab.id, 'applyAnswers', currentValidatedPayload.snapshotId, currentValidatedPayload.answers);

            qaApplyBtn.textContent = "Apply Suggested Choices";

            if (!response || !response.success) {
                showQaAlert(response && response.error ? response.error : "Failed to apply choices.");
                qaApplyBtn.disabled = false;
                return;
            }

            showQaAlert(`Success! Applied choices for ${response.appliedCount} questions (${response.optionsToggledCount} controls updated). Uncertain/skipped: ${response.uncertainSkipped || 0}. Please review questions before submitting manually!`, 'success');
            qaApplyBtn.disabled = true;
        });
    }

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
