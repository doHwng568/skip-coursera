# Coursera Skipper

A Chrome Extension designed to automate the process of completing Coursera courses by skipping videos and reading materials.

## Features

- **Automated Video Skipping**: Automatically marks videos as watched.
  - Checks if a video can be skipped directly.
  - If not skippable, it simulates the "watch" functionality (start, progress update, end) via API calls.
- **Reading Material Completion**: Automatically marks reading supplements as completed.
- **Course Detection**: Automatically detects the current course slug, User ID, and reviews course materials.
- **Real-time Logging**: Provides a popup interface with real-time logs of the skipping process.

## Installation

1.  Clone or download this repository to your local machine.
2.  Open Google Chrome and navigate to `chrome://extensions/`.
3.  Enable **Developer mode** in the top right corner.
4.  Click **Load unpacked** and select the directory containing this project.

## Usage

1.  Log in to your [Coursera](https://www.coursera.org/) account.
2.  Navigate to the specific course page you want to complete (e.g., `https://www.coursera.org/learn/course-name`).
3.  Click the **Coursera Skipper** extension icon in your browser toolbar.
4.  Click the **Start Skipping** button in the popup.
5.  Wait for the process to complete. You can view the progress in the popup logs.

## Technical Details

- **Manifest V3**: Built using the latest Chrome Extension manifest version.
- **API Interaction**: Interacts directly with Coursera's internal APIs (`onDemandLectureVideos.v1`, `onDemandVideoProgresses.v1`, etc.) to simulate user activity.
- **Cookie Usage**: Utilizes the user's existing session cookies (specifically `CSRF3-Token`) to authenticate requests.

## Disclaimer

This tool is for educational purposes only. Using this tool to bypass course requirements may violate Coursera's Terms of Service. Use at your own risk.
