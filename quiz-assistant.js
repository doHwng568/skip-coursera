/**
 * quiz-assistant.js
 * 
 * ChatGPT Quiz Assistant (No API) for Coursera Skipper.
 * Handles DOM extraction, snapshot tracking, schema validation, and safe choice application.
 * 
 * Manifest V3 compatible. DOM references are kept strictly in-memory.
 */

(function (global) {
    'use strict';

    // Helper to strip hidden elements and Coursera watermark artifacts
    function cleanText(text) {
        if (!text || typeof text !== 'string') return '';
        return text
            // Strip Coursera static watermark phrases
            .replace(/Do you understand\?/gi, '')
            // Strip zero-width and invisible characters
            .replace(/[\u200B-\u200D\uFEFF]/g, '')
            // Normalize spaces and line breaks
            .replace(/\r\n/g, '\n')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n\s*\n\s*\n/g, '\n\n')
            .trim();
    }

    function emptyValidationSummary() {
        return {
            totalQuestionsInQuiz: 0,
            validAnswersCount: 0,
            uncertainCount: 0,
            missingCount: 0,
            invalidCount: 0
        };
    }

    // Extract visible and cleaned text safely from a DOM element
    function extractVisibleText(rootElement) {
        if (!rootElement) return '';
        try {
            if (rootElement.nodeType === 3) {
                return cleanText(rootElement.nodeValue || '');
            }
            if (rootElement.nodeType !== 1) {
                return '';
            }

            // In live browser DOM, innerText reflects rendered text excluding hidden/script elements
            let raw = '';
            if (typeof rootElement.innerText === 'string' && rootElement.innerText.trim()) {
                raw = rootElement.innerText;
            } else if (typeof rootElement.textContent === 'string') {
                raw = rootElement.textContent;
            }
            return cleanText(raw);
        } catch (e) {
            return cleanText(rootElement.textContent || '');
        }
    }

    function findQuestionContainerForInput(input) {
        if (!input) return null;
        const selectors = [
            'fieldset',
            '[data-testid*="question"]',
            '[data-testid*="Question"]',
            '[data-testid*="part-SubmissionWrapper"]',
            '[data-testid*="part-QuestionPrompt"]',
            '.rc-FormPartsQuestion',
            '.rc-Question',
            'div[role="group"]',
            'div[role="radiogroup"]',
            'div[class*="Question__container"]',
            'div[class*="FormPartsQuestion"]',
            'div[class*="Question"]',
            'div[class*="question"]',
            'div[class*="RadioGroup"]',
            'div[class*="checkboxAndRadio-group"]'
        ];

        for (const sel of selectors) {
            try {
                const el = input.closest ? input.closest(sel) : null;
                if (el) return el;
            } catch (e) { }
        }

        // Fallback: closest parent element before body
        return input.parentElement ? (input.parentElement.parentElement || input.parentElement) : input;
    }

    class CourseraQuizAssistant {
        constructor() {
            // In-memory snapshot cache: snapshotId -> snapshot details
            this.currentSnapshot = null;
        }

        /**
         * Scan the page and find all multiple-choice quiz questions
         * Returns an exportable JSON payload and snapshot metadata
         */
        exportQuiz() {
            try {
                if (typeof document === 'undefined') {
                    return { success: false, error: 'Document is not available' };
                }

                // 1. Find all candidate input controls on the page
                const candidateInputs = Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]'))
                    .filter(el => !el.disabled);

                const textInputs = Array.from(document.querySelectorAll('textarea.rc-Textarea, textarea, input[type="text"]'))
                    .filter(el => !el.disabled);

                if (candidateInputs.length === 0) {
                    return {
                        success: false,
                        error: 'No multiple-choice questions found on this page. If the quiz is still loading, please wait a moment and try again.',
                        questionCount: 0,
                        unsupportedCount: textInputs.length
                    };
                }

                // 2. Group inputs by question using input.name (for radios) and question container
                const questionGroups = [];
                const radioNameMap = new Map(); // name -> group

                candidateInputs.forEach(input => {
                    const isRadio = input.type === 'radio';
                    if (isRadio && input.name) {
                        if (radioNameMap.has(input.name)) {
                            radioNameMap.get(input.name).inputs.push(input);
                            return;
                        }
                    }

                    const container = findQuestionContainerForInput(input);
                    // Match existing group sharing same container (for checkboxes or radios without separate names)
                    const existingGroup = questionGroups.find(g => {
                        if (g.container !== container) return false;
                        if (isRadio && input.name) {
                            return !g.inputs.some(i => i.type === 'radio' && i.name && i.name !== input.name);
                        }
                        return true;
                    });

                    if (existingGroup) {
                        existingGroup.inputs.push(input);
                        if (isRadio && input.name) {
                            radioNameMap.set(input.name, existingGroup);
                        }
                    } else {
                        const newGroup = { container, inputs: [input] };
                        questionGroups.push(newGroup);
                        if (isRadio && input.name) {
                            radioNameMap.set(input.name, newGroup);
                        }
                    }
                });

                const snapshotId = `snapshot_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
                const questionsMap = new Map();
                const exportQuestions = [];
                let questionIndex = 1;

                // Count unsupported fill-in-the-blank questions
                let unsupportedCount = 0;
                try {
                    textInputs.forEach(ti => {
                        const container = findQuestionContainerForInput(ti);
                        const hasRadioOrCb = container && container.querySelector && container.querySelector('input[type="radio"], input[type="checkbox"]');
                        if (!hasRadioOrCb) {
                            unsupportedCount++;
                        }
                    });
                } catch (e) { }

                // 3. Process each question group
                for (const group of questionGroups) {
                    const { container, inputs } = group;
                    if (!inputs || inputs.length === 0) continue;

                    const radioInputs = inputs.filter(el => el.type === 'radio');
                    const checkboxInputs = inputs.filter(el => el.type === 'checkbox');

                    // Determine selection mode
                    let selectionMode = 'single';
                    let targetInputs = [];

                    if (checkboxInputs.length > 0 && radioInputs.length === 0) {
                        selectionMode = 'multiple';
                        targetInputs = checkboxInputs;
                    } else if (radioInputs.length > 0 && checkboxInputs.length === 0) {
                        selectionMode = 'single';
                        targetInputs = radioInputs;
                    } else if (checkboxInputs.length > 0 && radioInputs.length > 0) {
                        selectionMode = checkboxInputs.length >= radioInputs.length ? 'multiple' : 'single';
                        targetInputs = selectionMode === 'multiple' ? checkboxInputs : radioInputs;
                    }

                    if (targetInputs.length === 0) continue;

                    // Extract Question Text
                    let questionText = '';
                    const promptSelectors = [
                        '[data-testid*="question-prompt"]',
                        '[data-testid*="QuestionPrompt"]',
                        '[data-testid*="prompt"]',
                        '[data-e2e="question-text"]',
                        '.rc-QuestionText',
                        '[data-testid="cml-viewer"]',
                        '.cml-viewer',
                        'legend',
                        'h2, h3, h4',
                        'p[class*="prompt"]',
                        'div[class*="prompt"]'
                    ];

                    if (container && container.querySelector) {
                        for (const sel of promptSelectors) {
                            try {
                                const promptEl = container.querySelector(sel);
                                if (promptEl) {
                                    // Ensure the prompt element is not an option label
                                    const isInsideOption = targetInputs.some(inp => {
                                        const lbl = inp.closest ? inp.closest('label') : null;
                                        return lbl && lbl.contains(promptEl);
                                    });
                                    if (!isInsideOption) {
                                        const txt = extractVisibleText(promptEl);
                                        if (txt && txt.length > 2) {
                                            questionText = txt;
                                            break;
                                        }
                                    }
                                }
                            } catch (e) { }
                        }
                    }

                    if (!questionText && container) {
                        let fullText = extractVisibleText(container);
                        targetInputs.forEach(inp => {
                            const lbl = inp.closest ? inp.closest('label') : null;
                            if (lbl) {
                                const lblTxt = extractVisibleText(lbl);
                                if (lblTxt) fullText = fullText.replace(lblTxt, '');
                            }
                        });
                        const firstLine = fullText.split('\n').map(s => s.trim()).filter(Boolean)[0];
                        questionText = firstLine || `Question ${questionIndex}`;
                    }

                    // Remove leading question numbers (e.g. "1. ", "Question 1: ")
                    questionText = questionText.replace(/^(?:Question\s*\d+[:.]?|\d+[:.)])\s*/i, '').trim();
                    if (!questionText) questionText = `Question ${questionIndex}`;

                    const questionId = `Q${String(questionIndex).padStart(3, '0')}`;
                    const optionsMap = new Map();
                    const exportOptions = [];
                    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

                    targetInputs.forEach((inputEl, optIdx) => {
                        const optionId = `${questionId}_O${String(optIdx + 1).padStart(3, '0')}`;
                        const labelChar = alphabet[optIdx] || `${optIdx + 1}`;

                        let optionText = '';

                        let associatedLabel = null;
                        // 1. Associated <label> wrapping the input (e.g. .cds-checkboxAndRadio-label)
                        try {
                            const wrappingLabel = inputEl.closest ? inputEl.closest('label') : null;
                            if (wrappingLabel) {
                                optionText = extractVisibleText(wrappingLabel);
                                associatedLabel = wrappingLabel;
                            }
                        } catch (e) { }

                        // 2. <label for="...">
                        if (!optionText && inputEl.id) {
                            try {
                                const escapedId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(inputEl.id) : inputEl.id;
                                const forLabel = (container && container.querySelector ? container.querySelector(`label[for="${escapedId}"]`) : null) ||
                                                 document.querySelector(`label[for="${escapedId}"]`);
                                if (forLabel) {
                                    optionText = extractVisibleText(forLabel);
                                    if (!associatedLabel) associatedLabel = forLabel;
                                }
                            } catch (e) { }
                        }

                        // 3. Next sibling or parent option wrapper
                        if (!optionText) {
                            try {
                                const parentOpt = inputEl.closest ? inputEl.closest('.rc-Option, .cui-inputGroupLabel, [data-testid="option-label"], div[class*="option"], div[class*="Option"]') : null;
                                if (parentOpt) {
                                    optionText = extractVisibleText(parentOpt);
                                } else if (inputEl.nextElementSibling) {
                                    optionText = extractVisibleText(inputEl.nextElementSibling);
                                } else if (inputEl.parentElement) {
                                    optionText = extractVisibleText(inputEl.parentElement);
                                }
                            } catch (e) { }
                        }

                        if (!optionText && inputEl.value && inputEl.value !== 'on') {
                            optionText = inputEl.value;
                        }

                        optionText = cleanText(optionText);
                        // Strip leading option letter (e.g. "A. Option Text" -> "Option Text")
                        optionText = optionText.replace(new RegExp(`^${labelChar}[.)\\s]+`, 'i'), '').trim();
                        if (!optionText) {
                            optionText = `Option ${labelChar}`;
                        }

                        optionsMap.set(optionId, {
                            optionId,
                            optIdx: optIdx,
                            label: labelChar,
                            text: optionText,
                            inputEl: inputEl,
                            labelEl: associatedLabel
                        });

                        exportOptions.push({
                            optionId,
                            label: labelChar,
                            text: optionText
                        });
                    });

                    questionsMap.set(questionId, {
                        questionId,
                        selectionMode,
                        questionText,
                        container,
                        optionsMap
                    });

                    exportQuestions.push({
                        questionId,
                        selectionMode,
                        questionText,
                        options: exportOptions
                    });

                    questionIndex++;
                }

                if (exportQuestions.length === 0) {
                    return {
                        success: false,
                        error: 'No multiple-choice questions found on this page. If the quiz is still loading, please wait a moment and try again.',
                        questionCount: 0,
                        unsupportedCount
                    };
                }

                // Save snapshot in memory
                this.currentSnapshot = {
                    snapshotId,
                    timestamp: Date.now(),
                    url: typeof window !== 'undefined' ? window.location.href : '',
                    questionsMap,
                    unsupportedCount
                };

                const payload = {
                    schemaVersion: 1,
                    snapshotId,
                    task: "You are a professional quiz assistant. Evaluate each question and provide the correct optionId(s). For multiple-choice questions (selectionMode=multiple), include ALL correct optionIds in the selectedOptionIds array. Return ONLY a valid JSON object matching this schema:\n{\n  \"snapshotId\": \"" + snapshotId + "\",\n  \"schemaVersion\": 1,\n  \"answers\": [\n    {\n      \"questionId\": \"Q001\",\n      \"selectedOptionIds\": [\"Q001_O001\", \"Q001_O003\"],\n      \"status\": \"answered\",\n      \"confidence\": \"high\",\n      \"reason\": \"Brief explanation\"\n    }\n  ]\n}",
                    questions: exportQuestions,
                    responseContract: {
                        schemaVersion: 1,
                        preserveSnapshotId: true,
                        oneAnswerObjectPerQuestion: true,
                        selectedOptionIdsMustExistInQuestion: true,
                        selectionModeMustBeRespected: true,
                        uncertainAnswersMustNotBeApplied: true,
                        outputOnlyJson: true
                    }
                };

                return {
                    success: true,
                    snapshotId,
                    questionCount: exportQuestions.length,
                    unsupportedCount,
                    payload
                };
            } catch (err) {
                console.error("[Skipper] Error in exportQuiz:", err);
                return {
                    success: false,
                    error: "Failed to extract quiz: " + (err.message || String(err)),
                    questionCount: 0,
                    unsupportedCount: 0
                };
            }
        }

        /**
         * Validates answers from ChatGPT against the current in-memory snapshot.
         * Generates preview items and checks DOM connectivity.
         */
        validateAnswers(snapshotId, answersInput) {
            try {
                if (!this.currentSnapshot) {
                    return {
                        valid: false,
                        error: 'No active quiz snapshot found. Please click "Copy Quiz JSON" first while on Coursera.',
                        summary: emptyValidationSummary()
                    };
                }

                if (this.currentSnapshot.snapshotId !== snapshotId) {
                    return {
                        valid: false,
                        error: `Snapshot ID mismatch (Expected "${this.currentSnapshot.snapshotId}", got "${snapshotId}"). Please re-copy Quiz JSON.`,
                        summary: emptyValidationSummary()
                    };
                }

                // Verify DOM is still connected
                let isStale = false;
                for (const [, q] of this.currentSnapshot.questionsMap) {
                    for (const [, opt] of q.optionsMap) {
                        if (opt.inputEl && typeof opt.inputEl.isConnected === 'boolean' && !opt.inputEl.isConnected) {
                            isStale = true;
                            break;
                        }
                    }
                    if (isStale) break;
                }

                if (isStale) {
                    return {
                        valid: false,
                        error: 'The Coursera page was refreshed or re-rendered since the last snapshot. Please click "Copy Quiz JSON" again.',
                        summary: emptyValidationSummary()
                    };
                }

                let answersList = [];
                if (Array.isArray(answersInput)) {
                    answersList = answersInput;
                } else if (answersInput && Array.isArray(answersInput.answers)) {
                    answersList = answersInput.answers;
                } else {
                    return {
                        valid: false,
                        error: 'Invalid answers format: "answers" must be an array.',
                        summary: emptyValidationSummary()
                    };
                }

                const answersMap = new Map();
                const errors = [];
                const warnings = [];

                // Detect duplicate answers for the same questionId
                for (const ans of answersList) {
                    if (!ans || typeof ans !== 'object' || !ans.questionId) {
                        errors.push('One of the answers is missing a valid "questionId".');
                        continue;
                    }
                    if (answersMap.has(ans.questionId)) {
                        errors.push(`Duplicate answer provided for question ID: ${ans.questionId}`);
                    }
                    answersMap.set(ans.questionId, ans);
                }

                const previews = [];
                let validAnswersCount = 0;
                let uncertainCount = 0;
                let missingCount = 0;
                let invalidCount = 0;

                // Validate each question in the snapshot
                for (const [qId, q] of this.currentSnapshot.questionsMap) {
                    const answer = answersMap.get(qId);

                    if (!answer) {
                        missingCount++;
                        warnings.push(`Question ${qId} was not answered by ChatGPT.`);
                        previews.push({
                            questionId: qId,
                            questionText: q.questionText,
                            selectionMode: q.selectionMode,
                            status: 'missing',
                            confidence: 'none',
                            reason: 'Missing from AI response',
                            selectedOptionIds: [],
                            selectedOptionTexts: [],
                            valid: false,
                            error: 'Question omitted in response'
                        });
                        continue;
                    }

                    // Flexible answer resolution: accept selectedOptionIds, selectedOptionId, selected_option_ids, options, etc.
                    let rawSelected = answer.selectedOptionIds;
                    if (rawSelected === undefined || rawSelected === null) {
                        rawSelected = answer.selectedOptionId !== undefined ? answer.selectedOptionId :
                                     (answer.selected_option_ids !== undefined ? answer.selected_option_ids :
                                     (answer.selectedOptions !== undefined ? answer.selectedOptions :
                                     (answer.options !== undefined ? answer.options : null)));
                    }

                    // Check explicit uncertain status or completely missing choices
                    const isExplicitUncertain = answer.status === 'uncertain';
                    if (isExplicitUncertain || rawSelected === null || rawSelected === undefined) {
                        uncertainCount++;
                        previews.push({
                            questionId: qId,
                            questionText: q.questionText,
                            selectionMode: q.selectionMode,
                            status: 'uncertain',
                            confidence: answer.confidence || 'low',
                            reason: cleanText(answer.reason) || (isExplicitUncertain ? 'AI marked as uncertain' : 'No option provided'),
                            selectedOptionIds: [],
                            selectedOptionTexts: [],
                            valid: true,
                            error: null
                        });
                        continue;
                    }

                    // Normalize raw choices to flat list of strings, splitting commas if present
                    let rawTokens = [];
                    if (Array.isArray(rawSelected)) {
                        rawSelected.forEach(item => {
                            if (typeof item === 'string') {
                                item.split(',').map(s => s.trim()).filter(Boolean).forEach(id => rawTokens.push(id));
                            } else if (item && typeof item === 'object') {
                                const id = item.optionId || item.id || item.value || item.label;
                                if (id) rawTokens.push(String(id).trim());
                            } else if (item !== null && item !== undefined) {
                                rawTokens.push(String(item).trim());
                            }
                        });
                    } else if (typeof rawSelected === 'string' && rawSelected.trim()) {
                        rawSelected.split(',').map(s => s.trim()).filter(Boolean).forEach(id => rawTokens.push(id));
                    } else {
                        rawTokens.push(String(rawSelected).trim());
                    }

                    if (rawTokens.length === 0) {
                        uncertainCount++;
                        previews.push({
                            questionId: qId,
                            questionText: q.questionText,
                            selectionMode: q.selectionMode,
                            status: 'uncertain',
                            confidence: answer.confidence || 'low',
                            reason: cleanText(answer.reason) || 'Empty selection',
                            selectedOptionIds: [],
                            selectedOptionTexts: [],
                            valid: true,
                            error: null
                        });
                        continue;
                    }

                    // Map letter labels (e.g. "A", "b", "Option A") to optionId if AI returned labels
                    const resolvedOptionIds = [];
                    for (const candidate of rawTokens) {
                        if (q.optionsMap.has(candidate)) {
                            resolvedOptionIds.push(candidate);
                        } else {
                            const cleanCandidate = candidate.replace(/^option\s*/i, '').trim().toUpperCase();
                            let matchedOptId = null;
                            for (const [optId, opt] of q.optionsMap) {
                                if (opt.label && opt.label.toUpperCase() === cleanCandidate) {
                                    matchedOptId = optId;
                                    break;
                                }
                            }
                            if (matchedOptId) {
                                resolvedOptionIds.push(matchedOptId);
                                warnings.push(`Question ${qId}: Option label "${candidate}" mapped to ID "${matchedOptId}".`);
                            } else {
                                resolvedOptionIds.push(candidate);
                            }
                        }
                    }

                    // Deduplicate option IDs gracefully
                    let selectedOptionIds = Array.from(new Set(resolvedOptionIds));
                    if (selectedOptionIds.length !== resolvedOptionIds.length) {
                        warnings.push(`Question ${qId}: Duplicate option IDs in selection were automatically deduplicated.`);
                    }

                    // Check option IDs exist in this question
                    let hasUnknownOption = false;
                    const optionTexts = [];
                    for (const optId of selectedOptionIds) {
                        const opt = q.optionsMap.get(optId);
                        if (!opt) {
                            hasUnknownOption = true;
                            invalidCount++;
                            errors.push(`Question ${qId}: Option ID "${optId}" does not belong to this question.`);
                            previews.push({
                                questionId: qId,
                                questionText: q.questionText,
                                selectionMode: q.selectionMode,
                                status: 'invalid',
                                confidence: answer.confidence || 'unknown',
                                reason: cleanText(answer.reason) || '',
                                selectedOptionIds,
                                selectedOptionTexts: [],
                                valid: false,
                                error: `Option "${optId}" is invalid for this question`
                            });
                            break;
                        } else {
                            optionTexts.push(`${opt.label}. ${opt.text}`);
                        }
                    }

                    if (hasUnknownOption) {
                        continue;
                    }

                    // Check single-select vs multiple-select constraints
                    if (q.selectionMode === 'single' && selectedOptionIds.length !== 1) {
                        invalidCount++;
                        errors.push(`Question ${qId}: Single-choice question must have exactly 1 option selected (got ${selectedOptionIds.length}).`);
                        previews.push({
                            questionId: qId,
                            questionText: q.questionText,
                            selectionMode: q.selectionMode,
                            status: 'invalid',
                            confidence: answer.confidence || 'unknown',
                            reason: cleanText(answer.reason) || '',
                            selectedOptionIds,
                            selectedOptionTexts: optionTexts,
                            valid: false,
                            error: `Expected 1 choice for single-select, got ${selectedOptionIds.length}`
                        });
                        continue;
                    }

                    if (q.selectionMode === 'multiple' && selectedOptionIds.length < 1) {
                        invalidCount++;
                        errors.push(`Question ${qId}: Multiple-choice question must have at least 1 option selected.`);
                        previews.push({
                            questionId: qId,
                            questionText: q.questionText,
                            selectionMode: q.selectionMode,
                            status: 'invalid',
                            confidence: answer.confidence || 'unknown',
                            reason: cleanText(answer.reason) || '',
                            selectedOptionIds,
                            selectedOptionTexts: optionTexts,
                            valid: false,
                            error: 'At least 1 choice required'
                        });
                        continue;
                    }

                    validAnswersCount++;
                    previews.push({
                        questionId: qId,
                        questionText: q.questionText,
                        selectionMode: q.selectionMode,
                        status: 'answered',
                        confidence: answer.confidence || 'high',
                        reason: cleanText(answer.reason) || '',
                        selectedOptionIds,
                        selectedOptionTexts: optionTexts,
                        valid: true,
                        error: null
                    });
                }

                // Check for answers with unknown questionIds
                for (const [ansQId] of answersMap) {
                    if (!this.currentSnapshot.questionsMap.has(ansQId)) {
                        warnings.push(`AI returned answer for unknown question ID "${ansQId}", which was ignored.`);
                    }
                }

                const isOverallValid = errors.length === 0 && validAnswersCount > 0;

                return {
                    valid: isOverallValid,
                    snapshotId,
                    summary: {
                        totalQuestionsInQuiz: this.currentSnapshot.questionsMap.size,
                        validAnswersCount,
                        uncertainCount,
                        missingCount,
                        invalidCount
                    },
                    errors,
                    warnings,
                    previews
                };
            } catch (err) {
                console.error("[Skipper] Error in validateAnswers:", err);
                return {
                    valid: false,
                    error: "Validation error: " + (err.message || String(err)),
                    summary: emptyValidationSummary()
                };
            }
        }

        /**
         * Applies the validated choices to the actual DOM radio and checkbox inputs.
         * STRICT RULE: Never clicks Submit, Finish, Grade, or Next buttons!
         */
        async applyAnswers(snapshotId, answersInput) {
            try {
                const validation = this.validateAnswers(snapshotId, answersInput);
                if (!validation.valid && validation.summary && validation.summary.validAnswersCount === 0) {
                    return {
                        success: false,
                        snapshotId,
                        appliedCount: 0,
                        optionsToggledCount: 0,
                        uncertainSkipped: validation.summary ? validation.summary.uncertainCount : 0,
                        missingSkipped: validation.summary ? validation.summary.missingCount : 0,
                        error: validation.errors && validation.errors[0] ? validation.errors[0] : (validation.error || 'Validation failed. No valid answers to apply.'),
                        details: []
                    };
                }

                let appliedCount = 0;
                let optionsToggledCount = 0;
                const applyDetails = [];

                // Helper to toggle a control safely and notify React ChangeEventPlugin
                const toggleControl = async (inputEl, targetChecked) => {
                    if (!inputEl) return false;
                    if (inputEl.checked === targetChecked) return true;

                    try {
                        inputEl.focus();

                        // 1. Prime React value tracker so React ChangeEventPlugin will not discard the event
                        if (inputEl._valueTracker) {
                            inputEl._valueTracker.setValue(!targetChecked);
                        }

                        // 2. Perform native click directly on inputEl (bubbles to label and fires click)
                        inputEl.click();

                        // 3. Ensure native checked state is definitely targetChecked
                        if (inputEl.checked !== targetChecked) {
                            const proto = typeof window !== 'undefined' && window.HTMLInputElement ? window.HTMLInputElement.prototype : null;
                            const nativeSetter = proto ? Object.getOwnPropertyDescriptor(proto, 'checked')?.set : null;
                            if (nativeSetter) {
                                nativeSetter.call(inputEl, targetChecked);
                            } else {
                                inputEl.checked = targetChecked;
                            }
                        }

                        // 4. Force dispatch 'input' and 'change' events so React controlled state updates
                        inputEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                        inputEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

                        return inputEl.checked === targetChecked;
                    } catch (e) {
                        console.warn("[Skipper] Error toggling control:", e);
                        return false;
                    }
                };

                for (const preview of validation.previews) {
                    if (!preview.valid || preview.status !== 'answered') {
                        applyDetails.push({
                            questionId: preview.questionId,
                            status: 'skipped',
                            reason: preview.status === 'uncertain' ? 'Uncertain choice skipped' : (preview.error || 'Skipped')
                        });
                        continue;
                    }

                    const question = this.currentSnapshot.questionsMap.get(preview.questionId);
                    if (!question) continue;

                    let questionSuccess = true;
                    const chosenSet = new Set(preview.selectedOptionIds);

                    if (question.selectionMode === 'single') {
                        // Single choice (radio)
                        const targetOptId = preview.selectedOptionIds[0];
                        const targetOpt = question.optionsMap.get(targetOptId);

                        if (targetOpt) {
                            let radio = targetOpt.inputEl;
                            // Re-resolve live element from DOM in case React re-rendered
                            if (!radio || !radio.isConnected) {
                                if (question.container && question.container.isConnected) {
                                    const liveRadios = Array.from(question.container.querySelectorAll('input[type="radio"]'));
                                    if (targetOpt.optIdx !== undefined && liveRadios[targetOpt.optIdx]) {
                                        radio = liveRadios[targetOpt.optIdx];
                                    }
                                }
                            }
                            if (radio && !radio.checked) {
                                const ok = await toggleControl(radio, true);
                                if (ok) {
                                    optionsToggledCount++;
                                } else {
                                    questionSuccess = false;
                                }
                            }
                        } else {
                            questionSuccess = false;
                        }
                    } else {
                        // Multiple choice (checkbox)
                        for (const [optId, opt] of question.optionsMap) {
                            const shouldBeChecked = chosenSet.has(optId);

                            // Re-resolve live element from DOM in case previous option toggles caused React to re-render
                            let checkbox = opt.inputEl;
                            if (!checkbox || !checkbox.isConnected) {
                                if (question.container && question.container.isConnected) {
                                    const liveCheckboxes = Array.from(question.container.querySelectorAll('input[type="checkbox"]'));
                                    if (opt.optIdx !== undefined && liveCheckboxes[opt.optIdx]) {
                                        checkbox = liveCheckboxes[opt.optIdx];
                                    }
                                }
                            }
                            if (!checkbox || !checkbox.isConnected) {
                                if (opt.inputEl && opt.inputEl.id) {
                                    const byId = document.getElementById(opt.inputEl.id);
                                    if (byId) checkbox = byId;
                                }
                            }

                            if (checkbox && checkbox.checked !== shouldBeChecked) {
                                const ok = await toggleControl(checkbox, shouldBeChecked);
                                if (ok) {
                                    optionsToggledCount++;
                                } else {
                                    questionSuccess = false;
                                }
                                // Small delay between toggling options to let Coursera's React state settle
                                await new Promise(r => setTimeout(r, 100));
                            }
                        }
                    }

                    if (questionSuccess) {
                        appliedCount++;
                        applyDetails.push({
                            questionId: preview.questionId,
                            status: 'applied',
                            selectedOptionIds: preview.selectedOptionIds
                        });
                    } else {
                        applyDetails.push({
                            questionId: preview.questionId,
                            status: 'failed',
                            error: 'Failed to interact with one or more input controls'
                        });
                    }

                    // Small pause between questions
                    await new Promise(r => setTimeout(r, 30));
                }

                return {
                    success: appliedCount > 0,
                    snapshotId,
                    appliedCount,
                    optionsToggledCount,
                    uncertainSkipped: validation.summary.uncertainCount,
                    missingSkipped: validation.summary.missingCount,
                    details: applyDetails
                };
            } catch (err) {
                console.error("[Skipper] Error in applyAnswers:", err);
                return {
                    success: false,
                    error: "Failed to apply choices: " + (err.message || String(err)),
                    details: []
                };
            }
        }
    }

    // Export for browser environment
    if (typeof window !== 'undefined') {
        window.CourseraQuizAssistant = CourseraQuizAssistant;
        // Keep existing instance and snapshot while updating prototype methods to latest code
        if (window.courseraQuizAssistant) {
            Object.setPrototypeOf(window.courseraQuizAssistant, CourseraQuizAssistant.prototype);
        } else {
            window.courseraQuizAssistant = new CourseraQuizAssistant();
        }
    }

    // Export for CommonJS (for Node.js test environment)
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            CourseraQuizAssistant,
            cleanText,
            extractVisibleText
        };
    }

})(typeof globalThis !== 'undefined' ? globalThis : this);
