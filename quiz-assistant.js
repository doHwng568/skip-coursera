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

                        // 1. Associated <label> wrapping the input (e.g. .cds-checkboxAndRadio-label)
                        try {
                            const wrappingLabel = inputEl.closest ? inputEl.closest('label') : null;
                            if (wrappingLabel) {
                                optionText = extractVisibleText(wrappingLabel);
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
                            label: labelChar,
                            text: optionText,
                            inputEl: inputEl
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
                    task: "You are a professional quiz assistant. Evaluate each question and provide the correct optionId(s). Follow the response contract strictly. Return ONLY a valid JSON object matching the requested schema, with no markdown code blocks or additional text.",
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
                        summary: { total: 0, valid: 0, uncertain: 0, missing: 0, invalid: 0 }
                    };
                }

                if (this.currentSnapshot.snapshotId !== snapshotId) {
                    return {
                        valid: false,
                        error: `Snapshot ID mismatch (Expected "${this.currentSnapshot.snapshotId}", got "${snapshotId}"). Please re-copy Quiz JSON.`,
                        summary: { total: 0, valid: 0, uncertain: 0, missing: 0, invalid: 0 }
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
                        summary: { total: 0, valid: 0, uncertain: 0, missing: 0, invalid: 0 }
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
                        summary: { total: 0, valid: 0, uncertain: 0, missing: 0, invalid: 0 }
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

                    // Check uncertain status
                    const isUncertain = answer.status === 'uncertain' || 
                                        !answer.selectedOptionIds || 
                                        (Array.isArray(answer.selectedOptionIds) && answer.selectedOptionIds.length === 0);

                    if (isUncertain) {
                        uncertainCount++;
                        previews.push({
                            questionId: qId,
                            questionText: q.questionText,
                            selectionMode: q.selectionMode,
                            status: 'uncertain',
                            confidence: answer.confidence || 'low',
                            reason: cleanText(answer.reason) || 'AI marked as uncertain',
                            selectedOptionIds: [],
                            selectedOptionTexts: [],
                            valid: true,
                            error: null
                        });
                        continue;
                    }

                    // Ensure selectedOptionIds is an array
                    let selectedOptionIds = answer.selectedOptionIds;
                    if (!Array.isArray(selectedOptionIds)) {
                        if (typeof selectedOptionIds === 'string' && selectedOptionIds.trim()) {
                            selectedOptionIds = [selectedOptionIds.trim()];
                            warnings.push(`Question ${qId}: "selectedOptionIds" was a string, normalized to array.`);
                        } else {
                            invalidCount++;
                            errors.push(`Question ${qId}: "selectedOptionIds" must be an array.`);
                            previews.push({
                                questionId: qId,
                                questionText: q.questionText,
                                selectionMode: q.selectionMode,
                                status: 'invalid',
                                confidence: answer.confidence || 'unknown',
                                reason: cleanText(answer.reason) || '',
                                selectedOptionIds: [],
                                selectedOptionTexts: [],
                                valid: false,
                                error: '"selectedOptionIds" is not an array'
                            });
                            continue;
                        }
                    }

                    // Check for duplicates in selectedOptionIds
                    const uniqueIds = new Set(selectedOptionIds);
                    if (uniqueIds.size !== selectedOptionIds.length) {
                        invalidCount++;
                        errors.push(`Question ${qId}: contains duplicate selectedOptionIds.`);
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
                            error: 'Duplicate option IDs in selection'
                        });
                        continue;
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
                    summary: { total: 0, valid: 0, uncertain: 0, missing: 0, invalid: 0 }
                };
            }
        }

        /**
         * Applies the validated choices to the actual DOM radio and checkbox inputs.
         * STRICT RULE: Never clicks Submit, Finish, Grade, or Next buttons!
         */
        applyAnswers(snapshotId, answersInput) {
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

                        if (targetOpt && targetOpt.inputEl) {
                            const radio = targetOpt.inputEl;
                            if (!radio.checked) {
                                try {
                                    radio.focus();
                                    radio.click();
                                    radio.checked = true;
                                    radio.dispatchEvent(new Event('change', { bubbles: true }));
                                    radio.dispatchEvent(new Event('input', { bubbles: true }));
                                    optionsToggledCount++;
                                } catch (e) {
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
                            const checkbox = opt.inputEl;

                            if (checkbox && checkbox.checked !== shouldBeChecked) {
                                try {
                                    checkbox.focus();
                                    checkbox.click();
                                    checkbox.checked = shouldBeChecked;
                                    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                                    checkbox.dispatchEvent(new Event('input', { bubbles: true }));
                                    optionsToggledCount++;
                                } catch (e) {
                                    questionSuccess = false;
                                }
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
        window.courseraQuizAssistant = new CourseraQuizAssistant();
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
