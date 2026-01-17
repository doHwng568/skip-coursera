
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

        if (!this.csrfToken) {
            log("WARNING: CSRF3-Token cookie not found! Requests may fail.");
            console.warn("Available cookies:", document.cookie);
        } else {
            log("CSRF Token found.");
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
        const url = `${BASE_URL}opencourse.v1/user/${this.userId}/course/${this.slug}/item/${item.id}/lecture/videoEvents/play?autoEnroll=false`;
        const headers = { ...this.getHeaders(), 'Content-Type': 'application/json' };
        await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ contentRequestBody: {} })
        });
    }

    async endItem(item, metadata) {
        const url = `${BASE_URL}opencourse.v1/user/${this.userId}/course/${this.slug}/item/${item.id}/lecture/videoEvents/ended?autoEnroll=false`;
        const headers = { ...this.getHeaders(), 'Content-Type': 'application/json' };
        await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ contentRequestBody: {} })
        });
    }

    async updateProgress(item, metadata) {
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
}

// Logic to extract slug from URL
function getSlugFromUrl(url) {
    // Example: https://www.coursera.org/learn/machine-learning/home/welcome
    const match = url.match(/learn\/([^\/]+)/);
    return match ? match[1] : null;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START_SKIPPING") {
        const slug = getSlugFromUrl(window.location.href);
        if (!slug) {
            log("Could not detect course slug from URL.");
            sendResponse({ status: "error" });
            return;
        }

        const skipper = new SkiperaJS();
        skipper.getUserId().then(success => {
            if (success) {
                skipper.getCourse(slug);
            }
        });
        sendResponse({ status: "started" });
    }
    return true; // Keep channel open
});
