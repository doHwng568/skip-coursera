
// Configuration equivalent
const BASE_URL = "/api/";

// Helper to log to popup
function log(msg) {
    console.log("[Skipper] " + msg);
    chrome.runtime.sendMessage({ action: "LOG", message: msg });
}

// Cookie helper
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

class SkiperaJS {
    constructor() {
        this.userId = null;
        this.courseId = null;
        this.slug = null;
        this.csrfToken = getCookie("CSRF3-Token");
        this.isStopped = false; // Add stop flag

        if (!this.csrfToken) {
            log("WARNING: CSRF3-Token cookie not found! Requests may fail.");
            console.warn("Available cookies:", document.cookie);
        } else {
            // log("CSRF Token found.");
        }
    }

    stop() {
        this.isStopped = true;
        log("Stopping process...");
    }

    async autoDoPeerAssignment() {
        log("Starting Auto Do Peer Assignment (Refined)...");

        // Helper to simulate typing that triggers React/Slate updates
        const simulateInput = async (element, text) => {
            element.focus();

            // Try beforeinput first (modern way)
            const beforeInputEvent = new InputEvent('beforeinput', {
                inputType: 'insertText',
                data: text,
                bubbles: true,
                cancelable: true
            });
            element.dispatchEvent(beforeInputEvent);

            // Use insertText (works for Slate and textareas)
            document.execCommand('insertText', false, text);

            // Dispatch input event to signal change
            element.dispatchEvent(new InputEvent('input', {
                inputType: 'insertText',
                data: text,
                bubbles: true
            }));

            // Nudge with a real key to trigger reactive validation
            ['keydown', 'keyup'].forEach(type => {
                element.dispatchEvent(new KeyboardEvent(type, { key: ' ', code: 'Space', bubbles: true }));
            });

            await new Promise(r => setTimeout(r, 100));
        };

        // 1. Fill Title
        log("Looking for Title field...");
        const titleInput = document.querySelector('input#title') || document.querySelector('input[aria-label="Project Title"]');
        if (titleInput) {
            log("Filling Project Title...");
            await simulateInput(titleInput, "Project Submission - Coursera Skipper Automation");
        } else {
            log("Title field not found.");
        }

        // 2. Find and fill all text content areas
        log("Searching for assignment content fields...");
        const contentInputs = Array.from(document.querySelectorAll('textarea, div[data-slate-editor="true"], div[role="textbox"]'))
            .filter(el => el !== titleInput); // Don't re-fill title if it was found here

        log(`Found ${contentInputs.length} content fields.`);

        const fillerText = "In this assignment, I have focused on applying the key concepts learned throughout the module. I have ensured that all requirements are met and the implementation follows the best practices discussed in the lectures. The results obtained match the expected outcomes, demonstrating a clear understanding of the subject matter.";

        for (const input of contentInputs) {
            const currentVal = input.value || input.textContent || "";
            if (currentVal.trim().length > 20) continue;

            log("Filling content field...");
            await simulateInput(input, fillerText);
        }

        // 3. Check Agreement Checkbox
        log("Looking for agreement checkbox...");
        const agreementBox = document.querySelector('input#agreement-checkbox-base') || document.querySelector('input[type="checkbox"]');
        if (agreementBox) {
            if (!agreementBox.checked) {
                log("Checking agreement...");
                agreementBox.click();
                agreementBox.checked = true;
                agreementBox.dispatchEvent(new Event('change', { bubbles: true }));
            }
        } else {
            log("Agreement checkbox not found.");
        }

        log("Ready to submit. Looking for Submit button...");
        await new Promise(r => setTimeout(r, 1000));

        // 4. Find and click Submit button
        const buttons = Array.from(document.querySelectorAll('button'));
        const submitBtn = buttons.find(b => {
            const text = b.textContent.trim().toLowerCase();
            return ['submit', 'gửi', 'post', 'nộp bài'].some(w => text.includes(w)) && !b.disabled;
        });

        if (submitBtn) {
            log("Clicking Submit button...");
            submitBtn.click();

            // Handle confirmation dialog if it appears
            await new Promise(r => setTimeout(r, 1500));
            const confirmButtons = Array.from(document.querySelectorAll('button'));
            const finalConfirm = confirmButtons.find(b => {
                const text = b.textContent.trim().toLowerCase();
                // Avoid clicking the same submit button if it's still there
                return ['yes', 'có', 'confirm', 'xác nhận', 'submit'].some(w => text.includes(w)) && b !== submitBtn;
            });

            if (finalConfirm) {
                log("Clicking final confirmation...");
                finalConfirm.click();
            }

            log("Assignment submission triggered!");
        } else {
            log("Submit button not found or still disabled. Please review and click manually.");
        }
    }

    getHeaders() {
        return {
            'x-coursera-application': 'ondemand',
            'x-coursera-version': '3bfd497de04ae0fef167b747fd85a6fbc8fb55df',
            'x-requested-with': 'XMLHttpRequest',
            'x-csrf3-token': this.csrfToken
        };
    }

    async getUserId() {
        // Try getting user ID
        log("Fetching User ID...");
        try {
            const response = await fetch(BASE_URL + "adminUserPermissions.v1?q=my", {
                headers: this.getHeaders()
            });

            if (!response.ok) {
                log(`API Error: ${response.status} ${response.statusText}`);
                const text = await response.text();
                log("Response: " + text.substring(0, 100)); // Log first 100 chars
                return false;
            }

            const json = await response.json();

            if (json.elements && json.elements[0] && json.elements[0].id) {
                this.userId = json.elements[0].id;
                log("User ID: " + this.userId);
                return true;
            } else {
                log("Unexpected JSON structure:");
                log(JSON.stringify(json).substring(0, 200));
                return false;
            }
        } catch (e) {
            log("Error getting User ID: " + e.message);
            return false;
        }
    }

    async getCourse(slug) {
        this.slug = slug;
        const params = new URLSearchParams({
            "q": "slug",
            "slug": slug,
            "includes": "modules,lessons,passableItemGroups,passableItemGroupChoices,passableLessonElements,items,tracks,gradePolicy,gradingParameters,embeddedContentMapping",
            "fields": "moduleIds,onDemandCourseMaterialModules.v1(name,slug,description,timeCommitment,lessonIds,optional,learningObjectives),onDemandCourseMaterialLessons.v1(name,slug,timeCommitment,elementIds,optional,trackId),onDemandCourseMaterialPassableItemGroups.v1(requiredPassedCount,passableItemGroupChoiceIds,trackId),onDemandCourseMaterialPassableItemGroupChoices.v1(name,description,itemIds),onDemandCourseMaterialPassableLessonElements.v1(gradingWeight,isRequiredForPassing),onDemandCourseMaterialItems.v2(name,originalName,slug,timeCommitment,contentSummary,isLocked,lockableByItem,itemLockedReasonCode,trackId,lockedStatus,itemLockSummary,customDisplayTypenameOverride),onDemandCourseMaterialTracks.v1(passablesCount),onDemandGradingParameters.v1(gradedAssignmentGroups),contentAtomRelations.v1(embeddedContentSourceCourseId,subContainerId)",
            "showLockedItems": "true"
        });

        const response = await fetch(BASE_URL + "onDemandCourseMaterials.v2/?" + params.toString(), {
            headers: this.getHeaders()
        });
        const json = await response.json();

        this.courseId = json.elements[0].id;
        log("Course ID: " + this.courseId);

        const items = json.linked["onDemandCourseMaterialItems.v2"] || [];
        log("Found " + items.length + " items.");

        for (const item of items) {
            if (this.isStopped) {
                log("Process stopped by user.");
                break;
            }

            const typeName = item.contentSummary.typeName;
            if (typeName === "lecture") {
                log("Processing Video: " + item.name);
                await this.watchItem(item);
            } else if (typeName === "supplement") {
                log("Processing Reading: " + item.name);
                await this.readItem(item.id);
            } else {
                // log("Skipping type: " + typeName);
            }
        }

        chrome.runtime.sendMessage({ action: "FINISHED" });
    }

    async getVideoMetadata(itemId) {
        const params = new URLSearchParams({
            "includes": "video",
            "fields": "disableSkippingForward,startMs,endMs"
        });
        const response = await fetch(BASE_URL + `onDemandLectureVideos.v1/${this.courseId}~${itemId}?` + params.toString(), {
            headers: this.getHeaders()
        });
        const json = await response.json();

        try {
            return {
                can_skip: !json.elements[0].disableSkippingForward,
                tracking_id: json.linked["onDemandVideos.v1"][0].id
            };
        } catch (e) {
            log("Error getting video metadata: " + e.message);
            return null;
        }
    }

    async watchItem(item) {
        if (this.isStopped) return;
        const metadata = await this.getVideoMetadata(item.id);
        if (!metadata) return;

        if (metadata.can_skip) {
            log("  -> Skippable, ending directly.");
            await this.endItem(item, metadata);
        } else {
            log("  -> Watching...");
            await this.startItem(item);
            await this.updateProgress(item, metadata);
            await this.endItem(item, metadata);
        }
    }

    async startItem(item) {
        if (this.isStopped) return;
        const url = `${BASE_URL}opencourse.v1/user/${this.userId}/course/${this.slug}/item/${item.id}/lecture/videoEvents/play?autoEnroll=false`;
        const headers = { ...this.getHeaders(), 'Content-Type': 'application/json' };
        await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ contentRequestBody: {} })
        });
    }

    async endItem(item, metadata) {
        if (this.isStopped) return;
        const url = `${BASE_URL}opencourse.v1/user/${this.userId}/course/${this.slug}/item/${item.id}/lecture/videoEvents/ended?autoEnroll=false`;
        const headers = { ...this.getHeaders(), 'Content-Type': 'application/json' };
        await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ contentRequestBody: {} })
        });
    }

    async updateProgress(item, metadata) {
        if (this.isStopped) return;
        const url = `${BASE_URL}onDemandVideoProgresses.v1/${this.userId}~${this.courseId}~${metadata.tracking_id}`;
        const body = {
            videoProgressId: `${this.userId}~${this.courseId}~${metadata.tracking_id}`,
            viewedUpTo: (item.timeCommitment || 0) + 2000
        };

        const headers = { ...this.getHeaders(), 'Content-Type': 'application/json' };
        const res = await fetch(url, {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify(body)
        });

        // Slight delay to be safe
        await new Promise(r => setTimeout(r, 1000));
    }

    async readItem(itemId) {
        if (this.isStopped) return;
        const url = `${BASE_URL}onDemandSupplementCompletions.v1`;
        const body = {
            courseId: this.courseId,
            itemId: itemId,
            userId: Number(this.userId)
        };
        const headers = { ...this.getHeaders(), 'Content-Type': 'application/json' };
        await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });
    }

    async autoFillDiscussion() {
        log("Looking for discussion textbox...");
        const editor = document.querySelector('div[data-slate-editor="true"]') || document.querySelector('div[role="textbox"]');
        if (!editor) {
            log("Discussion textbox not found. Make sure you are on a discussion page.");
            return;
        }

        log("Activating editor and setting cursor...");
        editor.focus();

        // Use Selection API to ensure the cursor is inside the editor
        try {
            const range = document.createRange();
            const sel = window.getSelection();

            // Try to find the deepest first child that can have a selection
            let focusNode = editor;
            while (focusNode.firstChild && focusNode.firstChild.nodeType !== 3) {
                focusNode = focusNode.firstChild;
            }

            range.setStart(focusNode, 0);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        } catch (e) {
            log("Warning: Could not set selection: " + e.message);
        }

        // Simulate click
        ['mousedown', 'mouseup', 'click'].forEach(type => {
            editor.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        });

        await new Promise(r => setTimeout(r, 200));

        log("Filling discussion (bypassing paste blocks)...");
        const textToFill = "This course is very helpful! I learned a lot from the materials provided. Thank you!";

        // 1. Try beforeinput event (modern way Slate detects input)
        const beforeInputEvent = new InputEvent('beforeinput', {
            inputType: 'insertText',
            data: textToFill,
            bubbles: true,
            cancelable: true
        });
        editor.dispatchEvent(beforeInputEvent);

        // 2. Use insertText
        document.execCommand('insertText', false, textToFill);

        // 3. Dispatch input event
        editor.dispatchEvent(new InputEvent('input', {
            inputType: 'insertText',
            data: textToFill,
            bubbles: true
        }));

        // 4. Nudge the editor with a real keypress (Space) to trigger reactive updates
        const nudgeKeys = [' ', 'a', 'Backspace'];
        for (const key of nudgeKeys) {
            ['keydown', 'keypress', 'keyup'].forEach(type => {
                editor.dispatchEvent(new KeyboardEvent(type, {
                    key: key,
                    code: key === ' ' ? 'Space' : (key === 'a' ? 'KeyA' : 'Backspace'),
                    bubbles: true,
                    cancelable: true
                }));
            });
            await new Promise(r => setTimeout(r, 50));
        }

        log("Waiting for Post button to enable...");
        await new Promise(r => setTimeout(r, 1000));

        // Find Post button with more robust text matching
        const buttons = Array.from(document.querySelectorAll('button'));
        const postBtn = buttons.find(b => {
            const textContent = b.textContent.trim().toLowerCase();
            return ['post', 'reply', 'gửi', 'phản hồi', 'trả lời'].some(word => textContent.includes(word));
        });

        if (postBtn) {
            if (postBtn.disabled) {
                log("Post button is still disabled. Trying to force state update with Enter...");
                editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
                await new Promise(r => setTimeout(r, 500));
            }

            if (!postBtn.disabled) {
                log("Clicking Post button...");
                postBtn.click();
                log("Discussion submitted successfully!");
            } else {
                log("Post button is still disabled. Try clicking it manually or typing one character.");
            }
        } else {
            log("Post button not found. Please click it manually.");
        }
    }

    async autoGradePeer() {
        log("Starting Auto Grade Peer (Loop mode)...");

        const checkRemaining = () => {
            const countTd = document.querySelector('[data-testid="review-count"]');
            if (countTd) {
                const text = countTd.textContent.trim().toLowerCase();
                log(`Counter text detected: "${text}"`);

                // Case: "Done" or "0 left"
                if (text.includes('done') || text.includes('0 left') || text.includes('0 còn lại')) {
                    return 0;
                }

                const match = text.match(/(\d+)/);
                return match ? parseInt(match[1]) : 0;
            }
            return 999; // Default to high if not found to avoid premature stop
        };

        const waitFor = async (selector, timeout = 10000) => {
            const start = Date.now();
            while (Date.now() - start < timeout) {
                const el = document.querySelector(selector);
                if (el) return el;
                await new Promise(r => setTimeout(r, 500));
            }
            return null;
        };

        const waitForButtons = async (searchTerms, timeout = 10000, excludeNavigation = true) => {
            const start = Date.now();
            while (Date.now() - start < timeout) {
                if (this.isStopped) return null;

                const buttons = Array.from(document.querySelectorAll('button, a'));
                const found = buttons.find(b => {
                    const text = b.textContent.trim().toLowerCase();
                    const isMatch = searchTerms.some(w => text.includes(w)) && !b.disabled;

                    if (!isMatch) return false;

                    // If excludeNavigation is true, check if button is in a footer or nav area
                    if (excludeNavigation) {
                        const isNav = b.closest('nav') || b.closest('footer') ||
                            b.closest('[class*="navigation"]') ||
                            b.closest('[class*="Footer"]');
                        if (isNav) return false;

                        // Specifically avoid "Next Item" or "Mục tiếp theo"
                        if (text.includes('next item') || text.includes('mục tiếp theo') ||
                            text.includes('previous item') || text.includes('mục trước')) {
                            return false;
                        }
                    }

                    return true;
                });
                if (found) return found;
                await new Promise(r => setTimeout(r, 500));
            }
            return null;
        };

        while (true) {
            if (this.isStopped) break;

            // CRITICAL: Check if we are done BEFORE starting any work
            const remaining = checkRemaining();
            log(`Remaining reviews needed: ${remaining}`);

            if (remaining === 0) {
                log("Required reviews completed! Stopping loop to avoid optional work. 🎉");
                break;
            }

            // Check if we are still on a peer review url
            if (!window.location.href.includes('/peer/') && !window.location.href.includes('/grading/')) {
                log("Navigation detected away from peer review. Stopping loop.");
                break;
            }

            // 1. Wait for rubric (radio buttons) to load
            log("Waiting for rubric (radio buttons)...");
            const firstRadio = await waitFor('input[type="radio"]');
            if (!firstRadio) {
                log("Rubric not found. Checking for 'Review another' button...");
                const nextPeerBtn = await waitForButtons(['review another', 'chấm bài khác', 'review more'], 3000);
                if (nextPeerBtn) {
                    log("Found Next button. Clicking...");
                    nextPeerBtn.click();
                    await new Promise(r => setTimeout(r, 4000));
                    continue; // Re-evaluate loop (will check 'remaining' again)
                } else {
                    log("Neither rubric nor Next button found. Stopping.");
                    break;
                }
            } else {
                // 2. Handle Radio Buttons (Rubric)
                log("Filling rubric...");
                const radioButtons = document.querySelectorAll('input[type="radio"]');
                const radioGroups = {};
                radioButtons.forEach(rb => {
                    const name = rb.name;
                    if (!radioGroups[name]) radioGroups[name] = [];
                    radioGroups[name].push(rb);
                });

                for (const name in radioGroups) {
                    const group = radioGroups[name];
                    const maxOption = group[group.length - 1];
                    if (maxOption && !maxOption.checked) {
                        maxOption.click();
                        maxOption.checked = true;
                        maxOption.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
                log("Max scores selected.");

                // 3. Handle Text Boxes (Feedback)
                log("Filling feedback...");
                const feedbackText = "Excellent work! Everything is clearly presented and meets all requirements. Well done!";
                const textInputs = Array.from(document.querySelectorAll('textarea, div[data-slate-editor="true"], div[role="textbox"]'));

                for (const input of textInputs) {
                    const currentVal = input.value || input.textContent || "";
                    if (currentVal.trim().length > 5) continue;

                    input.focus();
                    if (input.tagName === 'TEXTAREA') {
                        input.value = feedbackText;
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    } else {
                        document.execCommand('insertText', false, feedbackText);
                        input.dispatchEvent(new InputEvent('input', { bubbles: true }));
                    }
                    await new Promise(r => setTimeout(r, 200));
                }

                log("Current peer graded. Looking for Submit button...");
                await new Promise(r => setTimeout(r, 1000));

                // 4. Find and click Submit
                const submitBtn = await waitForButtons(['submit', 'gửi', 'done', 'hoàn thành']);
                if (submitBtn) {
                    log(`Clicking Submit button.`);
                    submitBtn.click();
                    await new Promise(r => setTimeout(r, 4000)); // Wait for submission process
                } else {
                    log("Submit button not found. Stopping loop.");
                    break;
                }
            }

            log("Submission successful. Re-checking progress...");
        }

        log("Auto Grade Peer process ended.");
    }
}

// Logic to extract slug from URL
function getSlugFromUrl(url) {
    // Example: https://www.coursera.org/learn/machine-learning/home/welcome
    const match = url.match(/learn\/([^\/]+)/);
    return match ? match[1] : null;
}

let activeSkipper = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START_SKIPPING") {
        const slug = getSlugFromUrl(window.location.href);
        if (!slug) {
            log("Could not detect course slug from URL.");
            sendResponse({ status: "error" });
            return;
        }

        activeSkipper = new SkiperaJS();
        activeSkipper.getUserId().then(success => {
            if (success) {
                activeSkipper.getCourse(slug);
            }
        });
        sendResponse({ status: "started" });
    } else if (request.action === "STOP_SKIPPING") {
        if (activeSkipper) {
            activeSkipper.stop();
            // activeSkipper = null; // Don't null immediately if you want to inspect or restart logically, but for now simple stop is fine.
            sendResponse({ status: "stopped" });
        }
    } else if (request.action === "AUTO_DISCUSSION") {
        const skipper = activeSkipper || new SkiperaJS();
        skipper.autoFillDiscussion();
        sendResponse({ status: "processing" });
    } else if (request.action === "AUTO_GRADE_PEER") {
        const skipper = activeSkipper || new SkiperaJS();
        skipper.autoGradePeer();
        sendResponse({ status: "processing" });
    } else if (request.action === "AUTO_DO_ASSIGNMENT") {
        const skipper = activeSkipper || new SkiperaJS();
        skipper.autoDoPeerAssignment();
        sendResponse({ status: "processing" });
    }
    return true; // Keep channel open
});
