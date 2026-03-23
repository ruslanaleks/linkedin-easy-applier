# LinkedIn Auto Apply Chrome Extension

A Chrome extension that automates the "Easy Apply" process on LinkedIn job listings, making it faster and easier to apply for multiple positions.

## Features

- **One-Click Application**: Apply to LinkedIn jobs with a single click
- **Automatic Form Filling**: Automatically completes standard application steps
- **Job Keyword Filtering**: Customize keywords to target specific job types
- **Application Statistics**: Track your application history and success rate
- **Multi-Language Support**: Works with LinkedIn in various languages

## Installation

### Step 1: Download the Extension

1. Download this repository to your local machine
   - Option 1: Clone the repository using Git:
     ```
     git clone <repository-url>
     ```
   - Option 2: Download the ZIP file and extract it to a folder on your computer

### Step 2: Load the Extension in Chrome

1. Open Google Chrome
2. Navigate to `chrome://extensions/`
3. Enable "Developer mode" by toggling the switch in the top-right corner
4. Click "Load unpacked"
5. Select the folder containing the extension files (the folder with the `manifest.json` file)
6. The extension should now appear in your extensions list with the LinkedIn Auto Apply icon

### Step 3: Pin the Extension (Optional)

1. Click the puzzle piece icon in Chrome's toolbar
2. Find "LinkedIn Auto Apply" in the dropdown
3. Click the pin icon to keep it visible in your toolbar for easy access

## How to Use

1. Navigate to LinkedIn Jobs page (`https://www.linkedin.com/jobs/`)
2. Search for jobs you're interested in
3. Open a job listing that has the "Easy Apply" option
4. The extension will add three buttons to the page:
   - **Auto Apply**: Click this button to start the automated application process
   - **Stats**: View your application statistics
   - **Settings**: Configure job keywords and other settings

### Using the Auto Apply Feature

1. When viewing a job with "Easy Apply", click the "Auto Apply" button
2. The extension will:
   - Open the application modal
   - Fill in standard information (contact info, resume)
   - Handle basic application steps
   - Pause for your input when custom questions are detected
   - Submit the application when complete

### Configuring Settings

1. Click the "Settings" button to open the settings panel
2. Configure the following fields:
   - **Job Keywords**: Comma-separated list used for filtering/logging
   - **Phone Number**: Used to autofill the Contact info phone field
   - **English Level**: Used to auto-select English proficiency in additional steps
   - **AWS Experience**: Short summary used to fill AWS/cloud-related questions
   - **AWS Years of Experience**: Number used for AWS years questions (ES/EN)
   - **Java Years of Experience**: Number used for Java years questions (ES/EN)
   - **Custom English Level Text**: Optional localized text (e.g., "Profesional")
   - **Hispanic/Latino**: Demographic selection
   - **Languages (JSON)**: List of language proficiencies used to answer generic language questions. Example:
```
[
  { "name": "English", "level": "Profesional" },
  { "name": "Spanish", "level": "Nativo" }
]
```
   - **User Profile (JSON)**: Full profile object used to answer questions (phone, languages, experience). Minimal example:
```
{
  "phone": "+1 555 123 4567",
  "languages": [
    { "name": "English", "level": "Profesional" }
  ],
  "experience": [
    { "technology": "aws", "years": 3 },
    { "technology": "java", "years": 2 }
  ],
  "demographics": { "hispanic": "Yes" }
}
```
3. Click "Save Settings" to apply your changes

Notes:
- The extension stores settings locally in your browser (Chrome storage).
- If a phone field isn’t filled on some postings, it may be a custom component; please open DevTools, copy the field’s HTML, and open an issue.

## Troubleshooting

- **Extension Not Working**: Make sure you're on a LinkedIn job page with the "Easy Apply" option
- **Application Process Stops**: Some jobs may have custom questions that require manual input
- **Button Not Appearing**: Refresh the page or check if you're on a supported LinkedIn page
- **Phone not autofilled**: Ensure your phone is set in Settings. The extension looks for `type=tel`, and inputs labeled with “phone”/“mobile”. Some forms use masked inputs which may need special handling.

### Optional: Set Phone via Console Bridge
If DevTools console is not in the extension context, you can set your phone via a message bridge:
```javascript
window.postMessage({
  type: "LINKEDIN_APPLIER_SET_PHONE",
  payload: { phone: "+1 555 123 4567" }
}, "*");
```

## Privacy & Security

This extension:

- Only runs on LinkedIn job pages
- Does not collect or transmit your personal data
- Stores application statistics and settings locally in your browser
- Does not interfere with LinkedIn's security measures

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Disclaimer

This extension is not affiliated with LinkedIn. Use at your own discretion and ensure you're reviewing applications before submission.
