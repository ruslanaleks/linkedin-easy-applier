// background.js - Background script for LinkedIn Auto Apply extension

// Track application statistics
let stats = {
  totalApplied: 0,
  sessionsApplied: 0,
  lastApplied: null,
};

// Initialize job keywords
let jobKeywords = [
  "javascript",
  "JavaScript",
  "express.js",
  "Express.js",
  "HTML",
  "CSS",
  "PostgreSQL",
  "MongoDB",
  "MySQL",
  "node.js",
  "Node.js",
  "NodeJs",
  "react",
  "ReactJS",
  "NextJS",
  "PHP",
  "php",
  "NestJS",
  "angular",
  "Angular",
  "nest.js",
  "next.js",
  "keystone.js",
  "KeystoneJs",
  "typescript",
  "Typescript",
];

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "applicationSent") {
    // Update statistics
    stats.totalApplied++;
    stats.sessionsApplied++;
    stats.lastApplied = new Date().toISOString();

    // Save stats to storage
    chrome.storage.local.set({ applicationStats: stats }, () => {
      console.log("Application statistics updated:", stats);
    });

    // Send notification
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon48.png",
      title: "LinkedIn Auto Apply",
      message: `Application sent successfully! Total applications: ${stats.totalApplied}`,
      priority: 2,
    });

    sendResponse({ success: true });
  } else if (message.action === "getStats") {
    // Retrieve stats from storage
    chrome.storage.local.get("applicationStats", (data) => {
      if (data.applicationStats) {
        stats = data.applicationStats;
      }
      sendResponse({ stats: stats });
    });
    return true; // Required for async sendResponse
  } else if (message.action === "updateKeywords") {
    // Update job keywords
    jobKeywords = message.keywords;
    chrome.storage.local.set({ jobKeywords: jobKeywords });
    sendResponse({ success: true });
  } else if (message.action === "getKeywords") {
    // Retrieve job keywords
    chrome.storage.local.get("jobKeywords", (data) => {
      if (data.jobKeywords) {
        jobKeywords = data.jobKeywords;
      }
      sendResponse({ keywords: jobKeywords });
    });
    return true; // Required for async sendResponse
  }
});

// Reset session stats when browser starts
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get("applicationStats", (data) => {
    if (data.applicationStats) {
      stats = data.applicationStats;
      stats.sessionsApplied = 0;
      chrome.storage.local.set({ applicationStats: stats });
    }
  });
});

// Initialize stats and keywords from storage when extension loads
chrome.storage.local.get(["applicationStats", "jobKeywords"], (data) => {
  if (data.applicationStats) {
    stats = data.applicationStats;
    console.log("Loaded application statistics:", stats);
  } else {
    // Initialize stats if not found
    chrome.storage.local.set({ applicationStats: stats });
  }

  if (data.jobKeywords) {
    jobKeywords = data.jobKeywords;
    console.log("Loaded job keywords:", jobKeywords);
  } else {
    // Initialize keywords if not found
    chrome.storage.local.set({ jobKeywords: jobKeywords });
  }
});
