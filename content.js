
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
        }
    }

    stop() {
        this.isStopped = true;
        log("Stopping process...");
    }

    async autoDoPeerAssignment() {
        log("Starting Auto Do Peer Assignment...");

        const simulateInput = async (element, text) => {
            element.focus();
            const beforeInputEvent = new InputEvent('beforeinput', {
                inputType: 'insertText',
                data: text,
                bubbles: true,
                cancelable: true
            });
            element.dispatchEvent(beforeInputEvent);
            document.execCommand('insertText', false, text);
            element.dispatchEvent(new InputEvent('input', {
                inputType: 'insertText',
                data: text,
                bubbles: true
            }));
            ['keydown', 'keyup'].forEach(type => {
                element.dispatchEvent(new KeyboardEvent(type, { key: ' ', code: 'Space', bubbles: true }));
            });
            await new Promise(r => setTimeout(r, 100));
        };

        const titleInput = document.querySelector('input#title') || document.querySelector('input[aria-label="Project Title"]');
        if (titleInput) {
            await simulateInput(titleInput, "Project Submission - Coursera Skipper Automation");
        }

        const contentInputs = Array.from(document.querySelectorAll('textarea, div[data-slate-editor="true"], div[role="textbox"]'))
            .filter(el => el !== titleInput);

        const fillerText = "In this assignment, I have focused on applying the key concepts learned throughout the module. I have ensured that all requirements are met and the implementation follows the best practices discussed in the lectures. The results obtained match the expected outcomes, demonstrating a clear understanding of the subject matter.";

        for (const input of contentInputs) {
            const currentVal = input.value || input.textContent || "";
            if (currentVal.trim().length > 20) continue;
            await simulateInput(input, fillerText);
        }

        const agreementBox = document.querySelector('input#agreement-checkbox-base') || document.querySelector('input[type="checkbox"]');
        if (agreementBox && !agreementBox.checked) {
            agreementBox.click();
            agreementBox.checked = true;
            agreementBox.dispatchEvent(new Event('change', { bubbles: true }));
        }

        await new Promise(r => setTimeout(r, 1000));

        const buttons = Array.from(document.querySelectorAll('button'));
        const submitBtn = buttons.find(b => {
            const text = b.textContent.trim().toLowerCase();
            return ['submit', 'gửi', 'post', 'nộp bài'].some(w => text.includes(w)) && !b.disabled;
        });

        if (submitBtn) {
            submitBtn.click();
            await new Promise(r => setTimeout(r, 1500));
            const confirmButtons = Array.from(document.querySelectorAll('button'));
            const finalConfirm = confirmButtons.find(b => {
                const text = b.textContent.trim().toLowerCase();
                return ['yes', 'có', 'confirm', 'xác nhận', 'submit'].some(w => text.includes(w)) && b !== submitBtn;
            });

            if (finalConfirm) {
                finalConfirm.click();
            }
            log("Assignment submitted!");
        } else {
            log("Submit button not found or disabled.");
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
        try {
            const response = await fetch(BASE_URL + "adminUserPermissions.v1?q=my", {
                headers: this.getHeaders()
            });
            if (!response.ok) return false;
            const json = await response.json();
            if (json.elements && json.elements[0] && json.elements[0].id) {
                this.userId = json.elements[0].id;
                return true;
            }
            return false;
        } catch (e) {
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
            if (this.isStopped) break;
            const typeName = item.contentSummary.typeName;
            if (typeName === "lecture") {
                log("Processing Video: " + item.name);
                await this.watchItem(item);
            } else if (typeName === "supplement") {
                log("Processing Reading: " + item.name);
                await this.readItem(item.id);
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
            return null;
        }
    }

    async watchItem(item) {
        if (this.isStopped) return;
        const metadata = await this.getVideoMetadata(item.id);
        if (!metadata) return;

        if (metadata.can_skip) {
            await this.endItem(item, metadata);
        } else {
            await this.startItem(item);
            await this.updateProgress(item, metadata);
            await this.endItem(item, metadata);
        }
    }

    async startItem(item) {
        if (this.isStopped) return;
        const url = `${BASE_URL}opencourse.v1/user/${this.userId}/course/${this.slug}/item/${item.id}/lecture/videoEvents/play?autoEnroll=false`;
        await fetch(url, {
            method: 'POST',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ contentRequestBody: {} })
        });
    }

    async endItem(item, metadata) {
        if (this.isStopped) return;
        const url = `${BASE_URL}opencourse.v1/user/${this.userId}/course/${this.slug}/item/${item.id}/lecture/videoEvents/ended?autoEnroll=false`;
        await fetch(url, {
            method: 'POST',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
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
        await fetch(url, {
            method: 'PUT',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        await new Promise(r => setTimeout(r, 1000));
    }

    async readItem(itemId) {
        if (this.isStopped) return;
        const url = `${BASE_URL}onDemandSupplementCompletions.v1`;
        const body = { courseId: this.courseId, itemId: itemId, userId: Number(this.userId) };
        await fetch(url, {
            method: 'POST',
            headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    }

    async autoFillDiscussion() {
        const editor = document.querySelector('div[data-slate-editor="true"]') || document.querySelector('div[role="textbox"]');
        if (!editor) {
            log("Discussion textbox not found.");
            return;
        }

        editor.focus();
        try {
            const range = document.createRange();
            const sel = window.getSelection();
            let focusNode = editor;
            while (focusNode.firstChild && focusNode.firstChild.nodeType !== 3) {
                focusNode = focusNode.firstChild;
            }
            range.setStart(focusNode, 0);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        } catch (e) { }

        ['mousedown', 'mouseup', 'click'].forEach(type => {
            editor.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        });

        await new Promise(r => setTimeout(r, 200));

        const textToFill = "This course is very helpful! I learned a lot from the materials provided. Thank you!";
        const beforeInputEvent = new InputEvent('beforeinput', {
            inputType: 'insertText',
            data: textToFill,
            bubbles: true,
            cancelable: true
        });
        editor.dispatchEvent(beforeInputEvent);
        document.execCommand('insertText', false, textToFill);
        editor.dispatchEvent(new InputEvent('input', {
            inputType: 'insertText',
            data: textToFill,
            bubbles: true
        }));

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

        await new Promise(r => setTimeout(r, 1000));

        const buttons = Array.from(document.querySelectorAll('button'));
        const postBtn = buttons.find(b => {
            const textContent = b.textContent.trim().toLowerCase();
            return ['post', 'reply', 'gửi', 'phản hồi', 'trả lời'].some(word => textContent.includes(word));
        });

        if (postBtn) {
            if (postBtn.disabled) {
                editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
                await new Promise(r => setTimeout(r, 500));
            }

            if (!postBtn.disabled) {
                postBtn.click();
                log("Discussion submitted!");
            } else {
                log("Post button is still disabled.");
            }
        } else {
            log("Post button not found.");
        }
    }

    async autoGradePeer(expectedCount = 3) {
        log(`Starting Auto Grade Peer (Target: ${expectedCount})...`);
        let gradedCount = 0;

        const checkRemaining = () => {
            const countTd = document.querySelector('[data-testid="review-count"]');
            if (countTd) {
                const text = countTd.textContent.trim().toLowerCase();
                if (text.includes('done') || text.includes('0 left') || text.includes('0 còn lại')) return 0;
                const match = text.match(/(\d+)/);
                return match ? parseInt(match[1]) : 0;
            }
            return 999;
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
                    if (excludeNavigation) {
                        const isNav = b.closest('nav') || b.closest('footer') ||
                            b.closest('[class*="navigation"]') ||
                            b.closest('[class*="Footer"]');
                        if (isNav) return false;
                        if (text.includes('next item') || text.includes('mục tiếp theo') ||
                            text.includes('previous item') || text.includes('mục trước')) return false;
                    }
                    return true;
                });
                if (found) return found;
                await new Promise(r => setTimeout(r, 500));
            }
            return null;
        };

        while (gradedCount < expectedCount) {
            if (this.isStopped) break;

            const remaining = checkRemaining();
            if (remaining === 0) {
                log("Required reviews completed! 🎉");
                break;
            }

            if (!window.location.href.includes('/peer/') && !window.location.href.includes('/grading/')) break;

            const firstRadio = await waitFor('input[type="radio"]');
            if (!firstRadio) {
                const nextPeerBtn = await waitForButtons(['review another', 'chấm bài khác', 'review more'], 3000);
                if (nextPeerBtn) {
                    nextPeerBtn.click();
                    await new Promise(r => setTimeout(r, 4000));
                    continue;
                } else {
                    break;
                }
            } else {
                const radioButtons = document.querySelectorAll('input[type="radio"]');
                const radioGroups = {};
                radioButtons.forEach(rb => {
                    if (!radioGroups[rb.name]) radioGroups[rb.name] = [];
                    radioGroups[rb.name].push(rb);
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

                await new Promise(r => setTimeout(r, 1000));
                const submitBtn = await waitForButtons(['submit', 'gửi', 'done', 'hoàn thành']);
                if (submitBtn) {
                    submitBtn.click();
                    await new Promise(r => setTimeout(r, 4000));
                    log(`Submitted peer ${++gradedCount}/${expectedCount}.`);
                } else {
                    break;
                }
            }
        }

        if (gradedCount >= expectedCount) {
            log(`Successfully graded ${gradedCount} peers. 🎉`);
        }
        log("Process ended.");
    }

    async autoDoQuiz(provider, apiKey) {
        log(`Starting Auto Quiz using ${provider}...`);
        
        const elements = Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"], textarea.rc-Textarea, input[type="text"]'));
        if (elements.length === 0) {
            log("No quiz questions found on this page.");
            return;
        }

        let questions = [];
        let currentQuestion = null;
        let lastGroupName = null;

        elements.forEach((el, index) => {
            const isText = el.tagName === 'TEXTAREA' || el.type === 'text';
            const groupName = isText ? `text_${index}` : el.name;
            
            if (groupName !== lastGroupName) {
                currentQuestion = {
                    id: questions.length,
                    groupName: groupName,
                    isText: isText,
                    questionText: "",
                    options: [],
                    elementRef: isText ? el : null
                };
                
                let container = el.closest('fieldset, .rc-FormPartsQuestion, .rc-Question, div[role="group"], div[data-testid="question-block"]') || el.closest('div[class*="Question"]');
                if (container) {
                    currentQuestion.questionText = (container.innerText || "").split('\n')[0];
                    let qTextEl = container.querySelector('.rc-QuestionText, [data-e2e="question-text"], legend');
                    if (qTextEl) currentQuestion.questionText = qTextEl.innerText;
                } else {
                    let parent = el.closest('div');
                    currentQuestion.questionText = (parent && parent.parentElement ? parent.parentElement.innerText.split('\n')[0] : `Question ${questions.length + 1}`);
                }

                questions.push(currentQuestion);
                lastGroupName = groupName;
            }

            if (!isText) {
                const label = el.closest('label') || (el.id ? document.querySelector(`label[for="${el.id}"]`) : null);
                let optText = label ? label.innerText : (el.value || (el.nextSibling ? el.nextSibling.textContent : `Option ${currentQuestion.options.length + 1}`));
                currentQuestion.options.push({
                    index: currentQuestion.options.length,
                    text: optText.trim(),
                    elementRef: el
                });
            }
        });

        log(`Parsed ${questions.length} questions. Requesting AI sequentially...`);

        try {
            for (let i = 0; i < questions.length; i++) {
                if (this.isStopped) {
                    log("Auto Quiz stopped by user.");
                    break;
                }

                let q = questions[i];
                log(`Processing question ${i + 1}/${questions.length}: ${q.questionText.substring(0, 30)}...`);

                let prompt = "You are a highly intelligent expert taking a professional quiz. Evaluate the following question thoroughly and step-by-step before determining the correct answer. Your priority is absolute accuracy. Provide ONLY the correct option index (0-indexed) or the text to fill in.\n\n";

                let qDataForAI = { question_id: q.id, question_text: q.questionText };
                if (!q.isText) {
                    qDataForAI.options = q.options.map(o => ({ index: o.index, text: o.text }));
                } else {
                    qDataForAI.type = "fill-in-the-blank";
                }

                prompt += JSON.stringify(qDataForAI, null, 2);
                prompt += '\n\nOutput ONLY a highly accurate valid JSON object matching this exact format:\n{ "answers": [ { "question_id": ' + q.id + ', "selected_option_indices": [1], "text_answer": null } ] }';

                let aiResponseJson = null;
                if (provider === 'gemini' || provider === 'gemini-flash' || provider === 'gemini-pro') {
                    const modelName = provider === 'gemini-pro' ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: prompt }] }],
                            generationConfig: { response_mime_type: "application/json" }
                        })
                    });
                    const json = await res.json();
                    if (!res.ok) throw new Error(json.error?.message || "Gemini API Error");
                    let text = json.candidates[0].content.parts[0].text;
                    aiResponseJson = JSON.parse(text);
                } else if (provider === 'openai') {
                    const url = `https://api.openai.com/v1/chat/completions`;
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                        body: JSON.stringify({
                            model: "gpt-4o-mini",
                            messages: [{ role: "user", content: prompt }],
                            response_format: { type: "json_object" },
                            temperature: 0.2
                        })
                    });
                    const json = await res.json();
                    if (!res.ok) throw new Error(json.error?.message || "OpenAI API Error");
                    aiResponseJson = JSON.parse(json.choices[0].message.content);
                } else {
                    log("Unsupported AI provider.");
                    return;
                }

                let answers = aiResponseJson.answers || [aiResponseJson];
                if (!Array.isArray(answers)) {
                    answers = [answers];
                }

                for (let ans of answers) {
                    if (ans.question_id !== q.id) continue;
                    
                    if (q.isText && ans.text_answer) {
                        q.elementRef.focus();
                        const beforeInputEvent = new InputEvent('beforeinput', { inputType: 'insertText', data: ans.text_answer, bubbles: true, cancelable: true });
                        q.elementRef.dispatchEvent(beforeInputEvent);
                        document.execCommand('insertText', false, ans.text_answer);
                        q.elementRef.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: ans.text_answer, bubbles: true }));
                        q.elementRef.dispatchEvent(new Event('change', { bubbles: true }));
                    } else if (!q.isText && ans.selected_option_indices && Array.isArray(ans.selected_option_indices)) {
                        for (let idx of ans.selected_option_indices) {
                            let opt = q.options[idx];
                            if (opt && opt.elementRef && !opt.elementRef.checked) {
                                opt.elementRef.click();
                                opt.elementRef.checked = true;
                                opt.elementRef.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        }
                    }
                }

                // Add a delay to avoid rate limiting. Gemini Pro has strict rate limits.
                const waitTime = provider === 'gemini-pro' ? 2500 : 1000;
                await new Promise(r => setTimeout(r, waitTime));
            }

            if (!this.isStopped) {
                log("Auto Quiz completed successfully!");
            }
            chrome.runtime.sendMessage({ action: "FINISHED" });

        } catch (e) {
            log("AI Request Error: " + e.message);
            chrome.runtime.sendMessage({ action: "FINISHED" });
        }
    }
}

function getSlugFromUrl(url) {
    const match = url.match(/learn\/([^\/]+)/);
    return match ? match[1] : null;
}

let activeSkipper = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
        if (request.action === "START_SKIPPING") {
            const slug = getSlugFromUrl(window.location.href);
            if (!slug) {
                log("Could not detect course slug.");
                sendResponse({ status: "error" });
                return false;
            }
            activeSkipper = new SkiperaJS();
            activeSkipper.getUserId().then(success => {
                if (success) activeSkipper.getCourse(slug);
            });
            sendResponse({ status: "started" });
            return false;
        } else if (request.action === "STOP_SKIPPING") {
            if (activeSkipper) {
                activeSkipper.stop();
            }
            sendResponse({ status: "stopped" });
            return false;
        } else if (request.action === "AUTO_DISCUSSION") {
            const skipper = activeSkipper || new SkiperaJS();
            skipper.autoFillDiscussion();
            sendResponse({ status: "processing" });
            return false;
        } else if (request.action === "AUTO_GRADE_PEER") {
            const skipper = activeSkipper || new SkiperaJS();
            skipper.autoGradePeer(request.count || 3);
            sendResponse({ status: "processing" });
            return false;
        } else if (request.action === "AUTO_DO_ASSIGNMENT") {
            const skipper = activeSkipper || new SkiperaJS();
            skipper.autoDoPeerAssignment();
            sendResponse({ status: "processing" });
            return false;
        } else if (request.action === "AUTO_DO_QUIZ") {
            const skipper = activeSkipper || new SkiperaJS();
            skipper.autoDoQuiz(request.provider, request.apiKey);
            sendResponse({ status: "processing" });
            return false;
        } else if (request.action === "QUIZ_EXPORT_JSON") {
            const assistant = window.courseraQuizAssistant || (typeof CourseraQuizAssistant !== 'undefined' ? new CourseraQuizAssistant() : null);
            if (!assistant) {
                sendResponse({ success: false, error: "Quiz Assistant module not loaded." });
            } else {
                window.courseraQuizAssistant = assistant;
                const res = assistant.exportQuiz();
                sendResponse(res);
            }
            return false;
        } else if (request.action === "QUIZ_VALIDATE_ANSWERS") {
            const assistant = window.courseraQuizAssistant || (typeof CourseraQuizAssistant !== 'undefined' ? new CourseraQuizAssistant() : null);
            if (!assistant) {
                sendResponse({ valid: false, error: "Quiz Assistant module not loaded." });
            } else {
                window.courseraQuizAssistant = assistant;
                const res = assistant.validateAnswers(request.snapshotId, request.answers);
                sendResponse(res);
            }
            return false;
        } else if (request.action === "QUIZ_APPLY_ANSWERS") {
            const assistant = window.courseraQuizAssistant || (typeof CourseraQuizAssistant !== 'undefined' ? new CourseraQuizAssistant() : null);
            if (!assistant) {
                sendResponse({ success: false, error: "Quiz Assistant module not loaded." });
            } else {
                window.courseraQuizAssistant = assistant;
                const res = assistant.applyAnswers(request.snapshotId, request.answers);
                sendResponse(res);
            }
            return false;
        }
    } catch (err) {
        console.error("[Skipper] Error in message listener:", err);
        sendResponse({ success: false, error: err.message || String(err) });
        return false;
    }
    return false;
});
