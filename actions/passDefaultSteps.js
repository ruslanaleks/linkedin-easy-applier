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
    document.querySelector(".artdeco-button--primary").click();
    console.log("Passing default steps... DONE");
    return true;
  }
  return false;
};
