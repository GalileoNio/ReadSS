(() => {
  "use strict";

  const dialog = document.querySelector("#detail-dialog");
  if (!dialog) return;

  const panelContainer = dialog.querySelector(".dialog-scroll");
  const panels = [...dialog.querySelectorAll("[data-panel]")];
  const openers = [...document.querySelectorAll("[data-open]")];
  const switchers = [...dialog.querySelectorAll("[data-switch]")];
  const closeButton = dialog.querySelector("[data-close]");
  let lastTrigger = null;

  function panelTitle(key) {
    return dialog.querySelector(`#detail-title-${key}`);
  }

  function showPanel(key, focusTitle = true) {
    const next = panels.find((panel) => panel.dataset.panel === key);
    if (!next) return;

    panels.forEach((panel) => {
      panel.hidden = panel !== next;
    });
    dialog.setAttribute("aria-labelledby", `detail-title-${key}`);
    panelContainer.scrollTop = 0;

    if (focusTitle) {
      requestAnimationFrame(() => {
        panelTitle(key)?.focus({ preventScroll: true });
      });
    }
  }

  function openDetail(key, trigger) {
    lastTrigger = trigger;
    showPanel(key, false);
    if (!dialog.open) dialog.showModal();
    document.documentElement.classList.add("dialog-open");

    requestAnimationFrame(() => {
      panelContainer.scrollTop = 0;
      panelTitle(key)?.focus({ preventScroll: true });
    });
  }

  function closeDetail() {
    if (dialog.open) dialog.close();
  }

  openers.forEach((button) => {
    button.addEventListener("click", () => openDetail(button.dataset.open, button));
  });

  switchers.forEach((button) => {
    button.addEventListener("click", () => showPanel(button.dataset.switch));
  });

  closeButton?.addEventListener("click", closeDetail);

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDetail();
  });

  dialog.addEventListener("close", () => {
    document.documentElement.classList.remove("dialog-open");
    if (lastTrigger) {
      lastTrigger.focus({ preventScroll: true });
      lastTrigger = null;
    }
  });

  const form = document.querySelector("#demo-form");
  const formSuccess = document.querySelector("#form-success");
  const formStatus = form?.querySelector(".form-status");

  if (!form || !formSuccess) return;

  const nameInput = form.querySelector("#applicant-name");
  const emailInput = form.querySelector("#applicant-email");
  const interestInput = form.querySelector("#applicant-interest");
  const nameError = form.querySelector("#name-error");
  const emailError = form.querySelector("#email-error");
  const interestError = form.querySelector("#interest-error");

  const fields = [
    {
      input: nameInput,
      error: nameError,
      validate() {
        const value = nameInput.value.trim();
        if (!value) return "请填写称呼。";
        if ([...value].length < 2) return "称呼至少需要 2 个字符。";
        return "";
      },
    },
    {
      input: emailInput,
      error: emailError,
      validate() {
        const value = emailInput.value.trim();
        if (!value) return "请填写邮箱地址。";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
          return "请输入有效的邮箱地址，例如 name@example.com。";
        }
        return "";
      },
    },
    {
      input: interestInput,
      error: interestError,
      validate() {
        if (!interestInput.value) return "请选择一项想先体验的内容。";
        return "";
      },
    },
  ];

  function setFieldState(field, message) {
    field.error.textContent = message;
    field.input.setAttribute("aria-invalid", message ? "true" : "false");
    return !message;
  }

  function validateField(field) {
    return setFieldState(field, field.validate());
  }

  function validateForm() {
    let firstInvalid = null;
    fields.forEach((field) => {
      const valid = validateField(field);
      if (!valid && !firstInvalid) firstInvalid = field.input;
    });
    return firstInvalid;
  }

  function clearErrors() {
    fields.forEach((field) => setFieldState(field, ""));
    if (formStatus) formStatus.textContent = "";
  }

  fields.forEach((field) => {
    const eventName = field.input.tagName === "SELECT" ? "change" : "input";
    field.input.addEventListener(eventName, () => {
      if (field.input.getAttribute("aria-invalid") === "true") {
        validateField(field);
      }
    });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (formStatus) formStatus.textContent = "";
    const firstInvalid = validateForm();

    if (firstInvalid) {
      if (formStatus) formStatus.textContent = "请检查标出的字段后再继续。";
      firstInvalid.focus();
      return;
    }

    form.hidden = true;
    formSuccess.hidden = false;
    formSuccess.focus();
  });

  form.addEventListener("reset", () => {
    requestAnimationFrame(clearErrors);
  });

  const restartButton = formSuccess.querySelector("[data-reset-form]");
  restartButton?.addEventListener("click", () => {
    form.reset();
    clearErrors();
    formSuccess.hidden = true;
    form.hidden = false;
    requestAnimationFrame(() => nameInput.focus());
  });
})();
