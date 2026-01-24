
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
        log("Starting Auto Grade Peer...");

        // 1. Handle Radio Buttons (Rubric)
        log("Searching for radio buttons...");
        const radioGroups = {};
        const radioButtons = document.querySelectorAll('input[type="radio"]');

        if (radioButtons.length === 0) {
            log("No radio buttons found. Ensure you are on the grading rubric page.");
        } else {
            radioButtons.forEach(rb => {
                const name = rb.name;
                if (!radioGroups[name]) radioGroups[name] = [];
                radioGroups[name].push(rb);
            });

            log(`Found ${Object.keys(radioGroups).length} criteria groups.`);

            for (const name in radioGroups) {
                const group = radioGroups[name];
                // Max score is usually the last radio button in the group
                const maxOption = group[group.length - 1];
                if (maxOption && !maxOption.checked) {
                    maxOption.click();
                    maxOption.checked = true;
                    // Trigger change event just in case
                    maxOption.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            log("Max scores selected for all criteria.");
        }

        // 2. Handle Text Boxes (Feedback)
        log("Searching for feedback text boxes...");
        const feedbackText = "Excellent work! Everything is clearly presented and meets all requirements. Well done!";

        // Find all potential text inputs: textareas and Slate editors
        const textInputs = Array.from(document.querySelectorAll('textarea, div[data-slate-editor="true"], div[role="textbox"]'));

        if (textInputs.length === 0) {
            log("No text feedback boxes found.");
        } else {
            for (const input of textInputs) {
                // Skip if already has content length > 10 (arbitrary)
                const currentVal = input.value || input.textContent || "";
                if (currentVal.trim().length > 5) continue;

                log("Filling feedback box...");
                input.focus();

                if (input.tagName === 'TEXTAREA') {
                    input.value = feedbackText;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                } else {
                    // Slate or other rich editor
                    document.execCommand('insertText', false, feedbackText);
                    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
                }
                await new Promise(r => setTimeout(r, 100));
            }
            log("Feedback boxes filled.");
        }

        log("Auto Grade Peer completed. Please review and click Submit.");
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
    }
    return true; // Keep channel open
});
