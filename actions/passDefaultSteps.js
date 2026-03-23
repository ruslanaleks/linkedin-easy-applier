// passDefaultSteps.js - Contains the action to pass default steps in the application process

// Initialize the global namespace for our extension
window.linkedInAutoApply = window.linkedInAutoApply || {};

// Default action strings that should be automatically handled
window.linkedInAutoApply.defaultAction = [
  "Contact info",
  "Kontaktinfo",
  "Dane kontaktowe",
  "Informazioni di contatto",
  "Información de contacto",
  "Contactgegevens",
  "Resume",
  "Currículum",
  "Curriculum",
  "Lebenslauf",
  "Coordonnée",
  "Cv",
  "CV",
];

/**
 * Action to pass default steps like contact info and resume
 * @returns {boolean} - True if action was successful, false otherwise
 */
window.linkedInAutoApply.passDefaultSteps = () => {
  console.log("Passing default steps...");
  if (
    document.querySelector("form .ph5 .t-16.t-bold") &&
    window.linkedInAutoApply.defaultAction.includes(
      document.querySelector("form .ph5 .t-16.t-bold").innerText
    )
  ) {
    // Try to autofill phone number on Contact info step before proceeding
    try {
      const headerText = document.querySelector("form .ph5 .t-16.t-bold")?.innerText || "";
      if (/contact info|kontaktinfo|dane kontaktowe|informazioni di contatto|información de contacto|contactgegevens|coordonnée/i.test(headerText)) {
        const modal = document.querySelector(
          ".artdeco-modal__content.jobs-easy-apply-modal__content.p0.ember-view"
        );
        const phoneFromSettings = window.linkedInAutoApply?.settings?.phoneNumber || "";
        if (modal && phoneFromSettings) {
          const candidates = window.linkedInAutoApply.utils.findPhoneInputs(modal);
          for (const el of candidates) {
            if (!el.value || !el.value.trim()) {
              console.log("Autofilling phone (default step) into:", el);
              window.linkedInAutoApply.utils.setFormControlValue(el, phoneFromSettings);
            }
          }
        }
      }
    } catch (e) {
      console.warn("Phone autofill on default step failed:", e);
    }

    // Delay click slightly so value settles
    setTimeout(() => {
      document.querySelector(".artdeco-button--primary")?.click();
    }, 150);
    console.log("Passing default steps... DONE");
    return true;
  }
  return false;
};
