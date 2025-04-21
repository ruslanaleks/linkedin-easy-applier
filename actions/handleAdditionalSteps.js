// handleAdditionalSteps.js - Contains the action to handle additional steps requiring user input

// Initialize the global namespace for our extension
window.linkedInAutoApply = window.linkedInAutoApply || {};

/**
 * Action to handle additional steps that require user input
 * @returns {boolean} - False to indicate user input is needed
 */
window.linkedInAutoApply.handleAdditionalSteps = () => {
  console.log("Additional step...");
  if (
    document.querySelector("form .ph5 .t-16.t-bold") &&
    !window.linkedInAutoApply.defaultAction.includes(
      document.querySelector("form .ph5 .t-16.t-bold").innerText
    )
  ) {
    // this is the modal which has input fields
    const modal = document.querySelector(
      ".artdeco-modal__content.jobs-easy-apply-modal__content.p0.ember-view"
    );

    // Get the next button
    let target = document.querySelector(
      ".artdeco-button.artdeco-button--2.artdeco-button--primary.ember-view"
    );

    // Check if all required input fields are already filled
    const inputFields = modal
      ? modal.querySelectorAll(".artdeco-text-input--input")
      : [];
    const selectFields = modal ? modal.querySelectorAll("select") : [];
    const radioButtons = modal
      ? modal.querySelectorAll("input[type='radio']")
      : [];

    let allFieldsFilled = true;

    // Check text inputs
    inputFields.forEach((input) => {
      // Check if the input is required and empty
      if (input.required && !input.value.trim()) {
        allFieldsFilled = false;
      }
    });

    // Check select fields
    selectFields.forEach((select) => {
      // Check if the select is required and has no selection
      if (select.required && select.selectedIndex === 0) {
        allFieldsFilled = false;
      }
    });

    // Check if at least one radio button in each group is selected
    const radioGroups = {};
    radioButtons.forEach((radio) => {
      if (radio.required) {
        if (!radioGroups[radio.name]) {
          radioGroups[radio.name] = false;
        }
        if (radio.checked) {
          radioGroups[radio.name] = true;
        }
      }
    });

    // Check if any radio group is missing a selection
    Object.values(radioGroups).forEach((isSelected) => {
      if (!isSelected) {
        allFieldsFilled = false;
      }
    });

    // If all required fields are filled, automatically click next
    if (allFieldsFilled && target) {
      console.log(
        "All required fields are already filled, automatically clicking next..."
      );
      target.click();

      return true;
    }

    // If not all fields are filled, wait for user input
    let onclickNext = () => {
      setTimeout(() => {
        window.linkedInAutoApply.apply();
      }, 1500);
      target.removeEventListener("click", onclickNext, true);
    };

    target.addEventListener("click", onclickNext, true);
    console.log("Waiting for your action!");
    return false;
  }
  return false;
};
