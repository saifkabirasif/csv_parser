/* ======================================================================
   CSV Search — Application Logic
   ====================================================================== */

(function () {
  "use strict";

  // ---- DOM refs ----
  const csvSelect = document.getElementById("csv-select");
  const csvFile = document.getElementById("csv-file");
  const uploadStatus = document.getElementById("upload-status");
  const searchSection = document.getElementById("search-section");
  const searchFields = document.getElementById("search-fields");
  const searchBtn = document.getElementById("search-btn");
  const clearBtn = document.getElementById("clear-btn");
  const resultSection = document.getElementById("result-section");
  const resultMessage = document.getElementById("result-message");
  const resultCount = document.getElementById("result-count");
  const resultTableWrap = document.getElementById("result-table-wrap");
  const themeSelect = document.getElementById("theme-select");

  // ---- State ----
  let csvData = null;
  let csvColumns = null;
  let columnIndex = null; // Map<colName, string[]>
  const MAX_RESULTS = 10;

  // ---- Theme ----
  const THEMES = [
    "theme-ocean",
    "theme-dark",
    "theme-forest",
    "theme-sunset",
    "theme-lavender",
    "theme-rose",
    "theme-midnight",
    "theme-arctic",
    "theme-espresso",
    "theme-cyber",
  ];

  function applyTheme(themeClass) {
    THEMES.forEach((t) => document.body.classList.remove(t));
    document.body.classList.add(themeClass);
    localStorage.setItem("csv-search-theme", themeClass);
  }

  (function initTheme() {
    const saved = localStorage.getItem("csv-search-theme") || "theme-ocean";
    applyTheme(saved);
    themeSelect.value = saved;
  })();

  themeSelect.addEventListener("change", () => {
    applyTheme(themeSelect.value);
  });

  // ---- Load file list ----
  async function loadManifest() {
    try {
      const res = await fetch("data/manifest.json");
      if (!res.ok) {
        throw new Error("HTTP " + res.status);
      }
      const files = await res.json();
      if (!Array.isArray(files) || files.length === 0) {
        throw new Error("No files in manifest");
      }
      csvSelect.innerHTML = '<option value="">— Select a file —</option>';
      files.forEach((f) => {
        const opt = document.createElement("option");
        opt.value = f;
        opt.textContent = f;
        csvSelect.appendChild(opt);
      });
      csvSelect.disabled = false;
    } catch (e) {
      csvSelect.innerHTML = '<option value="">No pre-loaded files available</option>';
      csvSelect.disabled = true;
      console.warn("Could not load data/manifest.json:", e.message);
    }
  }

  loadManifest();

  // ---- Parse CSV ----
  function parseCSV(source) {
    uploadStatus.textContent = "Parsing...";
    resultSection.classList.add("hidden");
    closeAllSuggestions();

    const onComplete = function (results) {
      if (results.errors && results.errors.length > 0) {
        uploadStatus.textContent = "Error parsing CSV: " + results.errors[0].message;
        return;
      }
      csvData = results.data;
      csvColumns = results.meta.fields;
      buildColumnIndex();
      buildSearchFields(csvColumns);
      searchSection.classList.remove("hidden");
      const colInfo = csvColumns.length + " columns, " + csvData.length + " rows";
      uploadStatus.textContent = source ? "Loaded: " + source + " (" + colInfo + ")" : "Loaded (" + colInfo + ")";
    };

    const onError = function (err) {
      uploadStatus.textContent = "Error: " + err.message;
    };

    return { onComplete, onError };
  }

  // ---- Dropdown select ----
  csvSelect.addEventListener("change", async () => {
    const filename = csvSelect.value;
    if (!filename) return;
    try {
      const res = await fetch("data/" + encodeURIComponent(filename));
      if (!res.ok) {
        uploadStatus.textContent = "Error fetching file: " + res.status;
        return;
      }
      const text = await res.text();
      const handlers = parseCSV(filename);
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: handlers.onComplete,
        error: handlers.onError,
      });
    } catch (e) {
      uploadStatus.textContent = "Error: " + e.message;
    }
  });

  // ---- File upload ----
  csvFile.addEventListener("change", () => {
    const file = csvFile.files[0];
    if (!file) return;
    const handlers = parseCSV(file.name);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: handlers.onComplete,
      error: handlers.onError,
    });
  });

  // ---- Build column index for intellisense ----
  function buildColumnIndex() {
    columnIndex = new Map();
    if (!csvData || !csvColumns) return;
    csvColumns.forEach((col) => {
      const seen = new Set();
      csvData.forEach((row) => {
        const val = (row[col] || "").trim();
        if (val !== "" && !seen.has(val)) {
          seen.add(val);
        }
      });
      columnIndex.set(col, Array.from(seen).sort());
    });
  }

  // ---- Build search fields ----
  function buildSearchFields(columns) {
    searchFields.innerHTML = "";
    columns.forEach((col) => {
      const div = document.createElement("div");
      div.className = "search-field";

      const label = document.createElement("label");
      label.textContent = col;
      label.setAttribute("for", "search-" + col);

      const input = document.createElement("input");
      input.type = "text";
      input.id = "search-" + col;
      input.dataset.column = col;
      input.placeholder = "Search " + col;
      input.autocomplete = "off";

      div.appendChild(label);
      div.appendChild(input);
      searchFields.appendChild(div);

      setupIntellisense(input, col);
    });
  }

  // ---- Intellisense ----
  let activeSuggestionIndex = -1;
  let currentSuggestionsList = null;

  function setupIntellisense(input, col) {
    const suggestionsEl = document.createElement("ul");
    suggestionsEl.className = "suggestions hidden";
    input.parentElement.appendChild(suggestionsEl);

    input.addEventListener("focus", () => {
      // show all suggestions if input is empty on focus
      if (input.value.trim() === "") {
        showSuggestions(input, suggestionsEl, col, "");
      }
    });

    input.addEventListener("input", () => {
      const query = input.value.trim();
      if (query === "") {
        showSuggestions(input, suggestionsEl, col, "");
      } else {
        showSuggestions(input, suggestionsEl, col, query);
      }
    });

    input.addEventListener("keydown", (e) => {
      if (!suggestionsEl.classList.contains("hidden")) {
        const items = suggestionsEl.querySelectorAll("li");
        if (e.key === "ArrowDown") {
          e.preventDefault();
          activeSuggestionIndex = Math.min(activeSuggestionIndex + 1, items.length - 1);
          highlightItem(items);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          activeSuggestionIndex = Math.max(activeSuggestionIndex - 1, 0);
          highlightItem(items);
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (activeSuggestionIndex >= 0 && activeSuggestionIndex < items.length) {
            selectSuggestion(input, suggestionsEl, items[activeSuggestionIndex]);
          } else {
            closeSuggestions(suggestionsEl);
            doSearch();
          }
        } else if (e.key === "Escape") {
          closeSuggestions(suggestionsEl);
        }
      } else if (e.key === "Enter") {
        doSearch();
      }
    });

    input.addEventListener("blur", () => {
      // delay to allow click on suggestion
      setTimeout(() => closeSuggestions(suggestionsEl), 200);
    });
  }

  function showSuggestions(input, suggestionsEl, col, query) {
    const values = columnIndex.get(col) || [];
    let matches;
    if (query === "") {
      matches = values.slice(0, MAX_RESULTS);
    } else {
      const lowerQuery = query.toLowerCase();
      matches = values.filter((v) => v.toLowerCase().includes(lowerQuery)).slice(0, MAX_RESULTS);
    }

    if (matches.length === 0) {
      suggestionsEl.classList.add("hidden");
      suggestionsEl.innerHTML = "";
      activeSuggestionIndex = -1;
      return;
    }

    suggestionsEl.innerHTML = "";
    activeSuggestionIndex = -1;

    matches.forEach((val) => {
      const li = document.createElement("li");
      if (query !== "") {
        li.innerHTML = highlightMatch(val, query);
      } else {
        li.textContent = val;
      }
      li.dataset.value = val;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault(); // prevent blur
        selectSuggestion(input, suggestionsEl, li);
      });
      suggestionsEl.appendChild(li);
    });

    suggestionsEl.classList.remove("hidden");
    currentSuggestionsList = suggestionsEl;
  }

  function highlightMatch(text, query) {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const idx = lowerText.indexOf(lowerQuery);
    if (idx === -1) return escapeHtml(text);
    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + query.length);
    const after = text.slice(idx + query.length);
    return escapeHtml(before) + "<mark>" + escapeHtml(match) + "</mark>" + escapeHtml(after);
  }

  function highlightItem(items) {
    items.forEach((li, i) => {
      li.classList.toggle("active", i === activeSuggestionIndex);
    });
    if (items[activeSuggestionIndex]) {
      items[activeSuggestionIndex].scrollIntoView({ block: "nearest" });
    }
  }

  function selectSuggestion(input, suggestionsEl, li) {
    input.value = li.dataset.value;
    closeSuggestions(suggestionsEl);
    doSearch();
  }

  function closeSuggestions(suggestionsEl) {
    suggestionsEl.classList.add("hidden");
    suggestionsEl.innerHTML = "";
    activeSuggestionIndex = -1;
  }

  function closeAllSuggestions() {
    document.querySelectorAll(".suggestions").forEach((el) => {
      el.classList.add("hidden");
      el.innerHTML = "";
    });
    activeSuggestionIndex = -1;
  }

  // ---- Search ----
  searchBtn.addEventListener("click", doSearch);

  function doSearch() {
    if (!csvData) return;
    closeAllSuggestions();

    const filters = {};
    searchFields.querySelectorAll("input").forEach((input) => {
      const val = input.value.trim();
      if (val) filters[input.dataset.column] = val;
    });

    resultMessage.textContent = "";
    resultMessage.className = "";
    resultCount.textContent = "";
    resultTableWrap.innerHTML = "";

    const filtered = csvData.filter((row) => {
      for (const [col, value] of Object.entries(filters)) {
        const cellValue = (row[col] || "").toLowerCase();
        if (!cellValue.includes(value.toLowerCase())) {
          return false;
        }
      }
      return true;
    });

    resultSection.classList.remove("hidden");

    if (filtered.length > MAX_RESULTS) {
      resultMessage.className = "error";
      resultMessage.textContent = "Too many results (" + filtered.length + "). Please narrow your search.";
      resultCount.textContent = "";
      resultTableWrap.innerHTML = "";
      return;
    }

    resultCount.textContent = filtered.length + " result(s) found";
    renderTable(csvColumns, filtered);
  }

  // ---- Clear ----
  clearBtn.addEventListener("click", () => {
    searchFields.querySelectorAll("input").forEach((input) => (input.value = ""));
    resultSection.classList.add("hidden");
    closeAllSuggestions();
  });

  // ---- Render table ----
  function renderTable(columns, rows) {
    let html = "<table><thead><tr>";
    columns.forEach((col) => (html += "<th>" + escapeHtml(col) + "</th>"));
    html += "</tr></thead><tbody>";
    rows.forEach((row) => {
      html += "<tr>";
      columns.forEach((col) => (html += "<td>" + escapeHtml(row[col] || "") + "</td>"));
      html += "</tr>";
    });
    html += "</tbody></table>";
    resultTableWrap.innerHTML = html;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();