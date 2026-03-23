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

    // Attempt to autofill known fields (phone, English level, AWS exp) before validation
    try {
      const phoneFromSettings = window.linkedInAutoApply?.settings?.phoneNumber || "";
      const englishLevel = window.linkedInAutoApply?.settings?.englishLevel || "";
      const awsExperience = window.linkedInAutoApply?.settings?.awsExperience || "";
      const hispanicOption = window.linkedInAutoApply?.settings?.hispanicOption || "";
      const awsYearsExperience = window.linkedInAutoApply?.settings?.awsYearsExperience || "";
      const englishLevelAlt = window.linkedInAutoApply?.settings?.englishLevelAlt || "";
      const javaYearsExperience = window.linkedInAutoApply?.settings?.javaYearsExperience || "";
      const languages = window.linkedInAutoApply?.settings?.languages || [];
      const userProfile = window.linkedInAutoApply?.settings?.userProfile || null;
      const authorizedToWorkInSpain = window.linkedInAutoApply?.settings?.authorizedToWorkInSpain || "";
      const preferredLocation = window.linkedInAutoApply?.settings?.preferredLocation || (userProfile?.location || "");
      if (modal && phoneFromSettings) {
        // Override by profile if provided
        const profilePhone = userProfile?.phone || userProfile?.contact?.phone;
        const phoneToUse = (profilePhone || phoneFromSettings);
        const phoneInputs = window.linkedInAutoApply.utils.findPhoneInputs(modal);
        for (const el of phoneInputs) {
          if (!el.value || !el.value.trim()) {
            console.log("Autofilling phone (additional step) into:", el);
            window.linkedInAutoApply.utils.setFormControlValue(el, phoneToUse);
          }
        }
      }

      // English level: try selects first (supports ES labels like "Inglés")
      if (modal && (englishLevel || englishLevelAlt)) {
        const selects = Array.from(modal.querySelectorAll("select"));
        for (const sel of selects) {
          const label = sel.closest("label")?.textContent || "";
          const aria = sel.getAttribute("aria-label") || "";
          if (/(english|ingl[ée]s)/i.test(label + " " + aria)) {
            const ok = window.linkedInAutoApply.utils.selectOptionByText(sel, englishLevelAlt || englishLevel);
            if (ok) break;
          }
        }
        // radios fallback
        window.linkedInAutoApply.utils.checkRadioByLabel(modal, "input[type='radio']", englishLevelAlt || englishLevel);
      }

      // Generic language questions: detect language name and set level from settings
      const langsFromProfile = Array.isArray(userProfile?.languages) ? userProfile.languages : [];
      const allLanguages = Array.isArray(languages) ? languages.slice() : [];
      langsFromProfile.forEach((l) => {
        if (l && l.name && !allLanguages.find((x) => (x.name || "").toLowerCase() === String(l.name).toLowerCase())) {
          allLanguages.push(l);
        }
      });
      if (modal && allLanguages.length) {
        const selects = Array.from(modal.querySelectorAll("select"));
        for (const sel of selects) {
          const label = sel.closest("label")?.textContent || "";
          const aria = sel.getAttribute("aria-label") || "";
          const text = (label + " " + aria).toLowerCase();
          const lang = allLanguages.find((l) => text.includes(String(l.name || "").toLowerCase()));
          if (lang && lang.level) {
            const ok = window.linkedInAutoApply.utils.selectOptionByText(sel, String(lang.level));
            if (ok) continue;
          }
        }
        const radios = Array.from(modal.querySelectorAll("input[type='radio']"));
        for (const r of radios) {
          let labelText = "";
          if (r.id) {
            const label = modal.querySelector(`label[for='${r.id}']`);
            if (label) labelText = label.textContent || "";
          }
          if (!labelText) {
            const parentLabel = r.closest("label");
            if (parentLabel) labelText = parentLabel.textContent || "";
          }
          if (!labelText) labelText = r.getAttribute("aria-label") || "";
          const text = (labelText || "").toLowerCase();
          const lang = allLanguages.find((l) => text.includes(String(l.name || "").toLowerCase()) && text.includes(String(l.level || "").toLowerCase()));
          if (lang) {
            r.checked = true;
            r.dispatchEvent(new Event("input", { bubbles: true }));
            r.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      }
      // Experience from userProfile (generic fallback)
      if (modal && (userProfile?.experience || userProfile?.skills)) {
        const entries = [];
        // Explicit experience entries
        if (Array.isArray(userProfile.experience)) {
          userProfile.experience.forEach((e) => entries.push(e));
        }
        // Also map skills -> experience years if present
        if (Array.isArray(userProfile.skills)) {
          userProfile.skills.forEach((s) => {
            if (!s || !s.name) return;
            const years = String(s.years || s.level || "").trim();
            if (!years) return;
            entries.push({ technology: s.name, years });
          });
        }
        const inputs = Array.from(modal.querySelectorAll("input[type='number'], input[type='text'], select, textarea"));
        for (const ent of entries) {
          const tech = String(ent.technology || ent.name || "").toLowerCase();
          const years = String(ent.years || "");
          if (!tech || !years) continue;
          for (const el of inputs) {
            const label = el.closest("label")?.textContent || "";
            const aria = el.getAttribute("aria-label") || "";
            const placeholder = el.getAttribute("placeholder") || "";
            const text = (label + " " + aria + " " + placeholder).toLowerCase();
            if (text.includes(tech) && /(años|anos|years|experience|experiencia)/.test(text)) {
              if (el.tagName && el.tagName.toLowerCase() === "select") {
                const ok = window.linkedInAutoApply.utils.selectOptionByText(el, years);
                if (ok) continue;
              } else if (!el.value || !String(el.value).trim()) {
                window.linkedInAutoApply.utils.setFormControlValue(el, years);
              }
            }
          }
        }
      }
      // Java years of experience (Spanish or English labels)
      if (modal && javaYearsExperience) {
        const inputs = Array.from(modal.querySelectorAll("input[type='number'], input[type='text'], select"));
        for (const el of inputs) {
          const label = el.closest("label")?.textContent || "";
          const aria = el.getAttribute("aria-label") || "";
          const placeholder = el.getAttribute("placeholder") || "";
          const text = (label + " " + aria + " " + placeholder).toLowerCase();
          if (
            /(java)/.test(text) &&
            /(años|anos|years|experience|experiencia)/.test(text)
          ) {
            if (el.tagName && el.tagName.toLowerCase() === "select") {
              const ok = window.linkedInAutoApply.utils.selectOptionByText(el, String(javaYearsExperience));
              if (ok) break;
            } else {
              if (!el.value || !String(el.value).trim()) {
                window.linkedInAutoApply.utils.setFormControlValue(el, String(javaYearsExperience));
                break;
              }
            }
          }
        }
      }
      // AWS years of experience: detect Spanish questions and common patterns
      if (modal && awsYearsExperience) {
        const inputs = Array.from(modal.querySelectorAll("input[type='number'], input[type='text'], select, textarea"));
        for (const el of inputs) {
          const label = el.closest("label")?.textContent || "";
          const aria = el.getAttribute("aria-label") || "";
          const placeholder = el.getAttribute("placeholder") || "";
          const text = (label + " " + aria + " " + placeholder).toLowerCase();
          if (
            /aws|amazon web services/.test(text) &&
            /(años|anos|years|experience|experiencia)/.test(text)
          ) {
            // If select, try options like "3" or "3 years"
            if (el.tagName && el.tagName.toLowerCase() === "select") {
              const ok = window.linkedInAutoApply.utils.selectOptionByText(el, String(awsYearsExperience));
              if (ok) break;
            } else {
              if (!el.value || !String(el.value).trim()) {
                window.linkedInAutoApply.utils.setFormControlValue(el, String(awsYearsExperience));
                break;
              }
            }
          }
        }

        // Also handle radio button based AWS experience questions (Spanish/English)
        try {
          const desiredYearsNum = Number(String(awsYearsExperience).replace(/[^0-9.]/g, ""));
          if (!Number.isNaN(desiredYearsNum)) {
            const radios = Array.from(modal.querySelectorAll("input[type='radio']"));
            // Group radios by name
            const groups = {};
            for (const r of radios) {
              if (!r.name) continue;
              if (!groups[r.name]) groups[r.name] = [];
              groups[r.name].push(r);
            }
            const groupNames = Object.keys(groups);
            for (const gName of groupNames) {
              const group = groups[gName];
              if (!group.length) continue;
              // Infer group/question text from nearest container
              const container = group[0].closest("fieldset, .fb-form-element, .jobs-easy-apply-form-section, .jobs-easy-apply-form-section__group, form, .artdeco-modal__content") || modal;
              const groupText = (container?.textContent || "").toLowerCase();
              if (!(/aws|amazon\s*web\s*services/.test(groupText) && /(años|anos|years|experience|experiencia)/.test(groupText))) {
                continue;
              }
              // Find the best matching radio by label text
              let best = null;
              for (const r of group) {
                let labelText = "";
                if (r.id) {
                  const labelEl = modal.querySelector(`label[for='${r.id}']`);
                  if (labelEl) labelText = labelEl.textContent || "";
                }
                if (!labelText) {
                  const parentLabel = r.closest("label");
                  if (parentLabel) labelText = parentLabel.textContent || "";
                }
                if (!labelText) labelText = r.getAttribute("aria-label") || "";
                const lt = (labelText || "").toLowerCase();
                // Heuristics
                const isLessThanOne = /(menos\s*de\s*1|<\s*1|0-1|0\s*a\s*1|under\s*1)/.test(lt);
                const isOneOrMore = /(1\+|1\s*\+|1\s*o\s*m[aá]s|at\s*least\s*1)/.test(lt);
                const moreThanFive = /(m[aá]s\s*de\s*5|>\s*5|5\+|5\s*o\s*m[aá]s|more\s*than\s*5)/.test(lt);
                const moreThanThree = /(m[aá]s\s*de\s*3|>\s*3|3\+|3\s*o\s*m[aá]s|more\s*than\s*3)/.test(lt);
                const numbers = Array.from(lt.matchAll(/\d+(?:[\.,]\d+)?/g)).map((m) => Number(m[0].replace(",", ".")));

                let score = 0;
                if (desiredYearsNum < 1 && isLessThanOne) score = 100;
                if (numbers.includes(desiredYearsNum)) score = Math.max(score, 90);
                // Handle ranges like "1-2", "2 a 3"
                if (numbers.length >= 2) {
                  const min = Math.min(numbers[0], numbers[1]);
                  const max = Math.max(numbers[0], numbers[1]);
                  if (desiredYearsNum >= min && desiredYearsNum <= max) score = Math.max(score, 95);
                }
                if (desiredYearsNum >= 5 && moreThanFive) score = Math.max(score, 92);
                if (desiredYearsNum >= 3 && moreThanThree) score = Math.max(score, 85);
                if (desiredYearsNum >= 1 && isOneOrMore) score = Math.max(score, 70);

                if (!best || score > best.score) {
                  best = { r, score };
                }
              }
              if (best && best.score >= 70) {
                best.r.checked = true;
                best.r.dispatchEvent(new Event("input", { bubbles: true }));
                best.r.dispatchEvent(new Event("change", { bubbles: true }));
                break;
              }
            }
          }
        } catch (_) {}
      }

      // AWS experience: try textarea/input matching aws keywords
      if (modal && awsExperience) {
        const textAreas = Array.from(modal.querySelectorAll("textarea, input[type='text']"));
        for (const ta of textAreas) {
          const label = ta.closest("label")?.textContent || "";
          const aria = ta.getAttribute("aria-label") || "";
          const placeholder = ta.getAttribute("placeholder") || "";
          if (/(aws|amazon\s*web\s*services|cloud\s*experience)/i.test(label + " " + aria + " " + placeholder)) {
            if (!ta.value || !String(ta.value).trim()) {
              window.linkedInAutoApply.utils.setFormControlValue(ta, awsExperience);
              break;
            }
          }
        }
      }

      // Hispanic/Latino demographic question
      if (modal && hispanicOption) {
        // Try selects labeled with ethnicity keywords
        const selects = Array.from(modal.querySelectorAll("select"));
        for (const sel of selects) {
          const label = sel.closest("label")?.textContent || "";
          const aria = sel.getAttribute("aria-label") || "";
          if (/(hispanic|latino|ethnicity|ethnic)/i.test(label + " " + aria)) {
            const ok = window.linkedInAutoApply.utils.selectOptionByText(sel, hispanicOption);
            if (ok) break;
          }
        }
        // radios fallback: check labels containing hispanic/latino
        const radioGroups = Array.from(modal.querySelectorAll("input[type='radio']"));
        for (const r of radioGroups) {
          let labelText = "";
          if (r.id) {
            const label = modal.querySelector(`label[for='${r.id}']`);
            if (label) labelText = label.textContent || "";
          }
          if (!labelText) {
            const parentLabel = r.closest("label");
            if (parentLabel) labelText = parentLabel.textContent || "";
          }
          if (!labelText) labelText = r.getAttribute("aria-label") || "";
          if (/(hispanic|latino)/i.test(labelText) && hispanicOption && labelText.toLowerCase().includes(hispanicOption.toLowerCase())) {
            r.checked = true;
            r.dispatchEvent(new Event("input", { bubbles: true }));
            r.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
        }
      }

      // Authorized to work in Spain: support ES/EN labels via select or radio
      if (modal && authorizedToWorkInSpain) {
        const selects = Array.from(modal.querySelectorAll("select"));
        for (const sel of selects) {
          const label = sel.closest("label")?.textContent || "";
          const aria = sel.getAttribute("aria-label") || "";
          const text = (label + " " + aria).toLowerCase();
          if (/(autorizad[oa]|permiso|autorizaci[óo]n).*trabajar.*espa[ñn]a|work.*authori[sz]ed.*spain/.test(text)) {
            const ok = window.linkedInAutoApply.utils.selectOptionByText(sel, authorizedToWorkInSpain);
            if (ok) break;
          }
        }
        // radios fallback
        const radios = Array.from(modal.querySelectorAll("input[type='radio']"));
        for (const r of radios) {
          let labelText = "";
          if (r.id) {
            const label = modal.querySelector(`label[for='${r.id}']`);
            if (label) labelText = label.textContent || "";
          }
          if (!labelText) {
            const parentLabel = r.closest("label");
            if (parentLabel) labelText = parentLabel.textContent || "";
          }
          if (!labelText) labelText = r.getAttribute("aria-label") || "";
          const lt = (labelText || "").toLowerCase();
          const wantYes = (authorizedToWorkInSpain || "").toLowerCase() === "yes";
          if (/^\s*(s[ií]|sí|si|yes)\s*$/.test(lt) && wantYes) {
            r.checked = true;
            r.dispatchEvent(new Event("input", { bubbles: true }));
            r.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
          if (/^\s*(no)\s*$/.test(lt) && !wantYes) {
            r.checked = true;
            r.dispatchEvent(new Event("input", { bubbles: true }));
            r.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
        }
      }

      // Location questions (city, country, location preference)
      if (modal && preferredLocation) {
        const inputs = Array.from(modal.querySelectorAll("input[type='text'], textarea, select"));
        for (const el of inputs) {
          const label = el.closest("label")?.textContent || "";
          const aria = el.getAttribute("aria-label") || "";
          const placeholder = el.getAttribute("placeholder") || "";
          const text = (label + " " + aria + " " + placeholder).toLowerCase();
          if (/(city|ciudad|location|ubicaci[óo]n|localidad|country|pa[ií]s)/.test(text)) {
            if ((el.tagName || "").toLowerCase() === "select") {
              // Try to match by text contains
              const ok = window.linkedInAutoApply.utils.selectOptionByText(el, preferredLocation);
              if (ok) continue;
            } else {
              if (!el.value || !String(el.value).trim()) {
                window.linkedInAutoApply.utils.setFormControlValue(el, preferredLocation);
                continue;
              }
            }
          }
        }
      }

      // Visa sponsorship needed? Default to No unless profile says otherwise
      if (modal) {
        const needsSponsorship = Boolean(userProfile?.visaSponsorshipNeeded);
        const desired = needsSponsorship ? "Yes" : "No";
        const selects = Array.from(modal.querySelectorAll("select"));
        for (const sel of selects) {
          const label = sel.closest("label")?.textContent || "";
          const aria = sel.getAttribute("aria-label") || "";
          const text = (label + " " + aria).toLowerCase();
          if (/(visa|sponsor|sponsorship|permiso|patrocinio|patrocinador)/.test(text)) {
            const ok = window.linkedInAutoApply.utils.selectOptionByText(sel, desired);
            if (ok) break;
          }
        }
        const radios = Array.from(modal.querySelectorAll("input[type='radio']"));
        for (const r of radios) {
          let labelText = "";
          if (r.id) {
            const label = modal.querySelector(`label[for='${r.id}']`);
            if (label) labelText = label.textContent || "";
          }
          if (!labelText) {
            const parentLabel = r.closest("label");
            if (parentLabel) labelText = parentLabel.textContent || "";
          }
          if (!labelText) labelText = r.getAttribute("aria-label") || "";
          const lt = (labelText || "").toLowerCase();
          const wantYes = desired.toLowerCase() === "yes";
          if (/\b(yes|s[ií]|sí)\b/.test(lt) && wantYes) {
            r.checked = true;
            r.dispatchEvent(new Event("input", { bubbles: true }));
            r.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
          if (/\bno\b/.test(lt) && !wantYes) {
            r.checked = true;
            r.dispatchEvent(new Event("input", { bubbles: true }));
            r.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
        }
      }

      // Notice period / availability to start
      if (modal) {
        const noticeDays = Number(userProfile?.noticePeriodDays ?? 0);
        const availabilityDate = userProfile?.availabilityDate ? new Date(userProfile.availabilityDate) : null;
        const immediateTextOptions = ["Immediate", "Immediately", "Inmediatamente", "Disponible inmediatamente", "0"];
        // Notice period numeric inputs/selects
        const inputs = Array.from(modal.querySelectorAll("input[type='number'], input[type='text'], select"));
        for (const el of inputs) {
          const label = el.closest("label")?.textContent || "";
          const aria = el.getAttribute("aria-label") || "";
          const placeholder = el.getAttribute("placeholder") || "";
          const text = (label + " " + aria + " " + placeholder).toLowerCase();
          if (/(notice|preaviso|periodo de preaviso|período de preaviso|weeks'\s*notice|weeks notice)/.test(text)) {
            const weeks = Math.round(noticeDays / 7);
            const value = String(weeks || 0);
            if ((el.tagName || "").toLowerCase() === "select") {
              const ok = window.linkedInAutoApply.utils.selectOptionByText(el, value);
              if (!ok) window.linkedInAutoApply.utils.selectOptionByText(el, immediateTextOptions[0]);
            } else if (!el.value || !String(el.value).trim()) {
              window.linkedInAutoApply.utils.setFormControlValue(el, value);
            }
          }
          // Availability start date text/select
          if (/(availability|available|start\s*date|fecha\s*de\s*inicio|disponibilidad)/.test(text)) {
            if ((el.tagName || "").toLowerCase() === "select") {
              // Try to pick Immediate
              for (const opt of immediateTextOptions) {
                const ok = window.linkedInAutoApply.utils.selectOptionByText(el, opt);
                if (ok) break;
              }
            } else if (el.getAttribute("type") === "date" && availabilityDate instanceof Date && !isNaN(availabilityDate)) {
              const yyyy = availabilityDate.getFullYear();
              const mm = String(availabilityDate.getMonth() + 1).padStart(2, "0");
              const dd = String(availabilityDate.getDate()).padStart(2, "0");
              const val = `${yyyy}-${mm}-${dd}`;
              if (!el.value) window.linkedInAutoApply.utils.setFormControlValue(el, val);
            }
          }
        }
        // Radios for immediate availability
        const availRadios = Array.from(modal.querySelectorAll("input[type='radio']"));
        for (const r of availRadios) {
          let labelText = "";
          if (r.id) {
            const label = modal.querySelector(`label[for='${r.id}']`);
            if (label) labelText = label.textContent || "";
          }
          if (!labelText) {
            const parentLabel = r.closest("label");
            if (parentLabel) labelText = parentLabel.textContent || "";
          }
          if (!labelText) labelText = r.getAttribute("aria-label") || "";
          const lt = (labelText || "").toLowerCase();
          if (/(immediate|immediately|inmediatamente)/.test(lt)) {
            r.checked = true;
            r.dispatchEvent(new Event("input", { bubbles: true }));
            r.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
        }
      }

      // Relocation willingness
      if (modal) {
        const willing = userProfile?.willingToRelocate;
        const desired = String(willing === false ? "No" : "Yes");
        const selects = Array.from(modal.querySelectorAll("select"));
        for (const sel of selects) {
          const label = sel.closest("label")?.textContent || "";
          const aria = sel.getAttribute("aria-label") || "";
          const text = (label + " " + aria).toLowerCase();
          if (/(relocat|reubic|mudanza)/.test(text)) {
            const ok = window.linkedInAutoApply.utils.selectOptionByText(sel, desired);
            if (ok) break;
          }
        }
        const radios = Array.from(modal.querySelectorAll("input[type='radio']"));
        for (const r of radios) {
          let labelText = "";
          if (r.id) {
            const label = modal.querySelector(`label[for='${r.id}']`);
            if (label) labelText = label.textContent || "";
          }
          if (!labelText) {
            const parentLabel = r.closest("label");
            if (parentLabel) labelText = parentLabel.textContent || "";
          }
          if (!labelText) labelText = r.getAttribute("aria-label") || "";
          const lt = (labelText || "").toLowerCase();
          const wantYes = desired.toLowerCase() === "yes";
          if (/\b(yes|s[ií]|sí)\b/.test(lt) && wantYes) {
            r.checked = true;
            r.dispatchEvent(new Event("input", { bubbles: true }));
            r.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
          if (/\bno\b/.test(lt) && !wantYes) {
            r.checked = true;
            r.dispatchEvent(new Event("input", { bubbles: true }));
            r.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
        }
      }

      // Work preference (Remote/Hybrid/On-site)
      if (modal && userProfile?.workPreference) {
        const pref = String(userProfile.workPreference).toLowerCase();
        const selects = Array.from(modal.querySelectorAll("select"));
        for (const sel of selects) {
          const label = sel.closest("label")?.textContent || "";
          const aria = sel.getAttribute("aria-label") || "";
          const text = (label + " " + aria).toLowerCase();
          if (/(work.*preference|modalidad|tipo.*trabajo|remote|hybrid|onsite|on-site)/.test(text)) {
            let desired = pref.includes("remote") ? "Remote" : pref.includes("hybrid") ? "Hybrid" : "On-site";
            const ok = window.linkedInAutoApply.utils.selectOptionByText(sel, desired);
            if (ok) break;
          }
        }
        const radios = Array.from(modal.querySelectorAll("input[type='radio']"));
        for (const r of radios) {
          let labelText = "";
          if (r.id) {
            const label = modal.querySelector(`label[for='${r.id}']`);
            if (label) labelText = label.textContent || "";
          }
          if (!labelText) {
            const parentLabel = r.closest("label");
            if (parentLabel) labelText = parentLabel.textContent || "";
          }
          if (!labelText) labelText = r.getAttribute("aria-label") || "";
          const lt = (labelText || "").toLowerCase();
          if ((pref.includes("remote") && /(remote|remoto)/.test(lt)) ||
              (pref.includes("hybrid") && /(hybrid|h[ií]brido)/.test(lt)) ||
              (pref.includes("site") && /(on\s*-?site|presencial)/.test(lt))) {
            r.checked = true;
            r.dispatchEvent(new Event("input", { bubbles: true }));
            r.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
        }
      }

      // Salary expectation
      if (modal) {
        const salary = userProfile?.salaryExpectation || window.linkedInAutoApply?.settings?.desiredSalary || "";
        if (salary) {
          const inputs = Array.from(modal.querySelectorAll("input[type='number'], input[type='text'], textarea, select"));
          for (const el of inputs) {
            const label = el.closest("label")?.textContent || "";
            const aria = el.getAttribute("aria-label") || "";
            const placeholder = el.getAttribute("placeholder") || "";
            const text = (label + " " + aria + " " + placeholder).toLowerCase();
            if (/(salary|compensation|pay|rate|expected|desired|salario|sueldo|remuneraci[óo]n)/.test(text)) {
              if ((el.tagName || "").toLowerCase() === "select") {
                const ok = window.linkedInAutoApply.utils.selectOptionByText(el, String(salary));
                if (ok) break;
              } else if (!el.value || !String(el.value).trim()) {
                window.linkedInAutoApply.utils.setFormControlValue(el, String(salary));
                break;
              }
            }
          }
        }
      }

      // Employment type preference
      if (modal && userProfile?.employmentTypePreference) {
        const pref = String(userProfile.employmentTypePreference).toLowerCase();
        const selects = Array.from(modal.querySelectorAll("select"));
        for (const sel of selects) {
          const label = sel.closest("label")?.textContent || "";
          const aria = sel.getAttribute("aria-label") || "";
          const text = (label + " " + aria).toLowerCase();
          if (/(employment|job|contract|schedule|tipo.*empleo|jornada)/.test(text)) {
            let desired = pref.includes("full") ? "Full-time" : pref.includes("part") ? "Part-time" : pref.includes("contract") ? "Contract" : "Full-time";
            const ok = window.linkedInAutoApply.utils.selectOptionByText(sel, desired);
            if (ok) break;
          }
        }
        const radios = Array.from(modal.querySelectorAll("input[type='radio']"));
        for (const r of radios) {
          let labelText = "";
          if (r.id) {
            const label = modal.querySelector(`label[for='${r.id}']`);
            if (label) labelText = label.textContent || "";
          }
          if (!labelText) {
            const parentLabel = r.closest("label");
            if (parentLabel) labelText = parentLabel.textContent || "";
          }
          if (!labelText) labelText = r.getAttribute("aria-label") || "";
          const lt = (labelText || "").toLowerCase();
          if ((pref.includes("full") && /(full[-\s]*time|tiempo\s*completo)/.test(lt)) ||
              (pref.includes("part") && /(part[-\s]*time|medio\s*tiempo|tiempo\s*parcial)/.test(lt)) ||
              (pref.includes("contract") && /(contract|contrato|contratista)/.test(lt))) {
            r.checked = true;
            r.dispatchEvent(new Event("input", { bubbles: true }));
            r.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
        }
      }
    } catch (e) {
      console.warn("Autofill step failed:", e);
    }

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
