/* ======================================================================
   CSV Search — Application Logic (GitHub Repo Edition)
   ====================================================================== */

(function () {
  "use strict";

  // ---- Constants ----
  var DEFAULT_OWNER = "saifkabirasif";
  var DEFAULT_REPO = "DataStore";
  var DEFAULT_PATH = "data";

  // ---- DOM refs ----
  var settingsBtn = document.getElementById("settings-btn");
  var settingsOverlay = document.getElementById("settings-overlay");
  var settingsClose = document.getElementById("settings-close");
  var settingsSave = document.getElementById("settings-save");
  var settingsCancel = document.getElementById("settings-cancel");
  var ghOwner = document.getElementById("gh-owner");
  var ghRepo = document.getElementById("gh-repo");
  var ghPath = document.getElementById("gh-path");
  var autoLoadCheck = document.getElementById("auto-load-check");
  var csvSelect = document.getElementById("csv-select");
  var csvFile = document.getElementById("csv-file");
  var uploadStatus = document.getElementById("upload-status");
  var searchSection = document.getElementById("search-section");
  var searchFields = document.getElementById("search-fields");
  var searchBtn = document.getElementById("search-btn");
  var clearBtn = document.getElementById("clear-btn");
  var resultSection = document.getElementById("result-section");
  var resultMessage = document.getElementById("result-message");
  var resultCount = document.getElementById("result-count");
  var resultTableWrap = document.getElementById("result-table-wrap");
  var shareRow = document.getElementById("share-row");
  var fmtTableBtn = document.getElementById("fmt-table");
  var fmtCsvBtn = document.getElementById("fmt-csv");
  var shareBtn = document.getElementById("share-btn");
  var btnPdf = document.getElementById("btn-pdf");
  var btnExcel = document.getElementById("btn-excel");
  var btnImage = document.getElementById("btn-image");
  var themeSelect = document.getElementById("theme-select");

  // ---- State ----
  var csvData = null;
  var csvColumns = null;
  var columnIndex = null;
  var lastFiltered = [];
  var shareFormat = localStorage.getItem("csv-search-format") || "table";
  var numericColumns = null;
  var MAX_RESULTS = 10;

  var repoState = {
    owner: "",
    repo: "",
    path: "",
    branch: "main",
  };

  // ---- Theme ----
  var THEMES = [
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
    THEMES.forEach(function (t) { document.body.classList.remove(t); });
    document.body.classList.add(themeClass);
    localStorage.setItem("csv-search-theme", themeClass);
  }

  (function initTheme() {
    var saved = localStorage.getItem("csv-search-theme") || "theme-ocean";
    applyTheme(saved);
    themeSelect.value = saved;
  })();

  themeSelect.addEventListener("change", function () {
    applyTheme(themeSelect.value);
  });

  // ---- Settings modal ----
  function openSettings() {
    settingsOverlay.classList.remove("hidden");
    ghOwner.focus();
  }

  function closeSettings() {
    settingsOverlay.classList.add("hidden");
  }

  settingsBtn.addEventListener("click", openSettings);
  settingsClose.addEventListener("click", closeSettings);
  settingsCancel.addEventListener("click", closeSettings);

  settingsOverlay.addEventListener("click", function (e) {
    if (e.target === settingsOverlay) closeSettings();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !settingsOverlay.classList.contains("hidden")) {
      closeSettings();
    }
  });

  settingsSave.addEventListener("click", function () {
    saveRepoConfig();
    closeSettings();
    loadFromGitHub();
  });

  // ---- Persist & restore repo config ----
  function saveRepoConfig() {
    localStorage.setItem("csv-search-gh", JSON.stringify({
      owner: ghOwner.value.trim(),
      repo: ghRepo.value.trim(),
      path: ghPath.value.trim(),
    }));
    localStorage.setItem("csv-search-auto-load", autoLoadCheck.checked ? "true" : "false");
  }

  function loadRepoConfig() {
    try {
      var saved = JSON.parse(localStorage.getItem("csv-search-gh") || "{}");
      ghOwner.value = saved.owner || DEFAULT_OWNER;
      ghRepo.value = saved.repo || DEFAULT_REPO;
      ghPath.value = saved.path || DEFAULT_PATH;
    } catch (_) {
      ghOwner.value = DEFAULT_OWNER;
      ghRepo.value = DEFAULT_REPO;
      ghPath.value = DEFAULT_PATH;
    }
    var autoLoad = localStorage.getItem("csv-search-auto-load");
    autoLoadCheck.checked = autoLoad !== "false";
  }

  loadRepoConfig();

  // ---- Detect default branch ----
  function detectBranch(owner, repo) {
    var endpoints = [
      "https://api.github.com/repos/" + owner + "/" + repo + "/contents?ref=main",
      "https://api.github.com/repos/" + owner + "/" + repo + "/contents?ref=master",
    ];
    var idx = 0;
    function tryNext() {
      if (idx >= endpoints.length) {
        return Promise.resolve("main");
      }
      var url = endpoints[idx];
      idx++;
      return fetch(url).then(function (res) {
        if (res.ok) {
          return url.indexOf("ref=main") !== -1 ? "main" : "master";
        }
        return tryNext();
      }).catch(function () {
        return tryNext();
      });
    }
    return tryNext();
  }

  // ---- Load file list from GitHub ----
  function loadFromGitHub() {
    var owner = ghOwner.value.trim();
    var repo = ghRepo.value.trim();
    var path = ghPath.value.trim();

    if (!owner || !repo) {
      uploadStatus.textContent = "Please configure a repository in Settings.";
      return;
    }

    uploadStatus.textContent = "Loading datasets from GitHub...";
    csvSelect.innerHTML = '<option value="">— Loading datasets... —</option>';
    csvSelect.disabled = true;
    searchSection.classList.add("hidden");
    resultSection.classList.add("hidden");
    csvData = null;
    csvColumns = null;
    shareRow.classList.add("hidden");

    saveRepoConfig();

    detectBranch(owner, repo).then(function (branch) {
      repoState = { owner: owner, repo: repo, path: path, branch: branch };

      var apiPath = path
        ? "https://api.github.com/repos/" + owner + "/" + repo + "/contents/" + encodeURIComponent(path).replace(/%2F/g, "/") + "?ref=" + branch
        : "https://api.github.com/repos/" + owner + "/" + repo + "/contents?ref=" + branch;

      return fetch(apiPath).then(function (res) {
        if (res.status === 403) {
          var rateRemaining = res.headers.get("X-RateLimit-Remaining");
          if (rateRemaining === "0") {
            throw new Error("GitHub API rate limit exceeded. Try again later or use a smaller repo.");
          }
          throw new Error("Access denied (403). The repo may be private.");
        }

        if (!res.ok) {
          if (res.status === 404) {
            throw new Error("Repo or path not found (404). Check owner/repo/path in Settings.");
          }
          throw new Error("GitHub API error: HTTP " + res.status);
        }

        return res.json();
      }).then(function (contents) {
        if (!Array.isArray(contents)) {
          throw new Error("Path does not point to a directory.");
        }

        var csvFiles = contents
          .filter(function (item) { return item.type === "file" && item.name.endsWith(".csv"); })
          .map(function (item) { return item.name; })
          .sort();

        if (csvFiles.length === 0) {
          throw new Error("No datasets found in the specified path.");
        }

        csvSelect.innerHTML = '<option value="">— Select a dataset —</option>';
        csvFiles.forEach(function (f) {
          var opt = document.createElement("option");
          opt.value = f;
          opt.textContent = formatFileName(f);
          csvSelect.appendChild(opt);
        });
        csvSelect.disabled = false;
        var label = owner + "/" + repo;
        if (path) label += "/" + path;
        label += " [" + branch + "]";
        uploadStatus.textContent = "Found " + csvFiles.length + " dataset(s) in " + label;
      });
    }).catch(function (e) {
      csvSelect.innerHTML = '<option value="">— No datasets loaded —</option>';
      csvSelect.disabled = true;
      uploadStatus.textContent = "Error: " + e.message;
    });
  }

  // ---- Parse CSV ----
  function parseCSV(source) {
    uploadStatus.textContent = "Parsing...";
    resultSection.classList.add("hidden");
    closeAllSuggestions();

    var handler = {};
    handler.onComplete = function (results) {
      if (results.errors && results.errors.length > 0) {
        uploadStatus.textContent = "Error parsing CSV: " + results.errors[0].message;
        return;
      }
      csvData = results.data;
      csvColumns = results.meta.fields;
      buildColumnIndex();
      detectNumericColumns();
      buildSearchFields(csvColumns);
      searchSection.classList.remove("hidden");
      var colInfo = csvColumns.length + " columns, " + csvData.length + " rows";
      uploadStatus.textContent = source ? "Loaded: " + source + " (" + colInfo + ")" : "Loaded (" + colInfo + ")";
    };

    handler.onError = function (err) {
      uploadStatus.textContent = "Error: " + err.message;
    };

    return handler;
  }

  // ---- Dropdown select ----
  csvSelect.addEventListener("change", function () {
    var filename = csvSelect.value;
    if (!filename) return;
    var owner = repoState.owner;
    var repo = repoState.repo;
    var path = repoState.path;
    var branch = repoState.branch;
    var prefix = path ? path + "/" : "";
    var rawUrl = "https://raw.githubusercontent.com/" + owner + "/" + repo + "/" + branch + "/" + prefix + encodeURIComponent(filename);

    uploadStatus.textContent = "Downloading " + filename + "...";
    fetch(rawUrl).then(function (res) {
      if (!res.ok) {
        uploadStatus.textContent = "Error fetching dataset: HTTP " + res.status;
        return;
      }
      return res.text();
    }).then(function (text) {
      if (!text) return;
      var handlers = parseCSV(filename);
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: handlers.onComplete,
        error: handlers.onError,
      });
    }).catch(function (e) {
      uploadStatus.textContent = "Error: " + e.message;
    });
  });

  // ---- File upload ----
  csvFile.addEventListener("change", function () {
    var file = csvFile.files[0];
    if (!file) return;
    var handlers = parseCSV(file.name);
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
    csvColumns.forEach(function (col) {
      var seen = new Set();
      csvData.forEach(function (row) {
        var val = (row[col] || "").trim();
        if (val !== "" && !seen.has(val)) {
          seen.add(val);
        }
      });
      columnIndex.set(col, Array.from(seen).sort());
    });
  }

  // ---- Detect numeric columns ----
  function detectNumericColumns() {
    numericColumns = new Map();
    if (!csvData || !csvColumns) return;
    csvColumns.forEach(function (col) {
      var numCount = 0;
      var total = 0;
      var dataMin = Infinity;
      var dataMax = -Infinity;
      var allIntegers = true;

      csvData.forEach(function (row) {
        var raw = (row[col] || "").trim();
        if (raw === "") return;
        total++;
        var num = Number(raw);
        if (!isNaN(num) && raw !== "") {
          numCount++;
          if (num < dataMin) dataMin = num;
          if (num > dataMax) dataMax = num;
          if (!Number.isInteger(num)) allIntegers = false;
        }
      });

      if (total === 0 || numCount / total < 0.8) return;

      if (dataMin === dataMax) {
        dataMax = dataMin + 1;
      }

      var step;
      if (allIntegers) {
        step = 1;
      } else {
        var span = dataMax - dataMin;
        step = Math.pow(10, Math.floor(Math.log10(Math.max(span / 100, 1e-10))));
        step = Math.max(step, 0.01);
      }

      numericColumns.set(col, {
        min: dataMin,
        max: dataMax,
        step: step,
        allIntegers: allIntegers,
      });
    });
  }

  // ---- Format number for display ----
  function formatNum(val, info) {
    if (info.allIntegers) return Math.round(val).toLocaleString();
    return parseFloat(val.toFixed(getDecimalPlaces(info.step))).toLocaleString();
  }

  function getDecimalPlaces(step) {
    var str = String(step);
    var dot = str.indexOf(".");
    return dot === -1 ? 0 : str.length - dot - 1;
  }

  // ---- Build search fields ----
  function buildSearchFields(columns) {
    searchFields.innerHTML = "";
    columns.forEach(function (col) {
      var numInfo = numericColumns.get(col);
      if (numInfo) {
        buildRangeField(col, numInfo);
      } else {
        buildTextField(col);
      }
    });
  }

  function buildTextField(col) {
    var div = document.createElement("div");
    div.className = "search-field";

    var label = document.createElement("label");
    label.textContent = col;
    label.setAttribute("for", "search-" + col);

    var input = document.createElement("input");
    input.type = "text";
    input.id = "search-" + col;
    input.dataset.column = col;
    input.dataset.type = "text";
    input.placeholder = "Search " + col;
    input.autocomplete = "off";

    div.appendChild(label);
    div.appendChild(input);
    searchFields.appendChild(div);

    setupIntellisense(input, col);
  }

  function buildRangeField(col, numInfo) {
    var div = document.createElement("div");
    div.className = "search-field numeric-field";

    var label = document.createElement("label");
    label.textContent = col;

    var rangeDisplay = document.createElement("div");
    rangeDisplay.className = "range-display";
    var minLabel = document.createElement("span");
    minLabel.className = "range-min-val";
    minLabel.textContent = formatNum(numInfo.min, numInfo);
    var separator = document.createElement("span");
    separator.className = "range-separator";
    separator.textContent = " \u2013 ";
    var maxLabel = document.createElement("span");
    maxLabel.className = "range-max-val";
    maxLabel.textContent = formatNum(numInfo.max, numInfo);

    rangeDisplay.appendChild(minLabel);
    rangeDisplay.appendChild(separator);
    rangeDisplay.appendChild(maxLabel);

    var sliderWrap = document.createElement("div");
    sliderWrap.className = "range-slider-wrap";

    var track = document.createElement("div");
    track.className = "range-track";
    var trackFill = document.createElement("div");
    trackFill.className = "range-track-fill";
    track.appendChild(trackFill);

    var minInput = document.createElement("input");
    minInput.type = "range";
    minInput.className = "range-min";
    minInput.dataset.column = col;
    minInput.dataset.type = "range";
    minInput.dataset.rangeType = "min";
    minInput.min = numInfo.min;
    minInput.max = numInfo.max;
    minInput.step = numInfo.step;
    minInput.value = numInfo.min;

    var maxInput = document.createElement("input");
    maxInput.type = "range";
    maxInput.className = "range-max";
    maxInput.dataset.column = col;
    maxInput.dataset.type = "range";
    maxInput.dataset.rangeType = "max";
    maxInput.min = numInfo.min;
    maxInput.max = numInfo.max;
    maxInput.step = numInfo.step;
    maxInput.value = numInfo.max;

    sliderWrap.appendChild(track);
    sliderWrap.appendChild(minInput);
    sliderWrap.appendChild(maxInput);

    div.appendChild(label);
    div.appendChild(rangeDisplay);
    div.appendChild(sliderWrap);
    searchFields.appendChild(div);

    setupRangeSlider(minInput, maxInput, numInfo, minLabel, maxLabel, trackFill);
  }

  function setupRangeSlider(minInput, maxInput, numInfo, minLabel, maxLabel, trackFill) {
    function updateDisplay() {
      var minVal = parseFloat(minInput.value);
      var maxVal = parseFloat(maxInput.value);

      if (minVal > maxVal) {
        if (document.activeElement === minInput) {
          maxInput.value = minVal;
          maxVal = minVal;
        } else {
          minInput.value = maxVal;
          minVal = maxVal;
        }
      }

      minLabel.textContent = formatNum(minVal, numInfo);
      maxLabel.textContent = formatNum(maxVal, numInfo);

      var range = numInfo.max - numInfo.min;
      var leftPct = range > 0 ? ((minVal - numInfo.min) / range) * 100 : 0;
      var rightPct = range > 0 ? ((maxVal - numInfo.min) / range) * 100 : 100;
      trackFill.style.left = leftPct + "%";
      trackFill.style.width = (rightPct - leftPct) + "%";

      minInput.closest(".numeric-field").dataset.filterMin = minVal;
      minInput.closest(".numeric-field").dataset.filterMax = maxVal;
      minInput.closest(".numeric-field").dataset.dataMin = numInfo.min;
      minInput.closest(".numeric-field").dataset.dataMax = numInfo.max;
    }

    minInput.addEventListener("input", updateDisplay);
    maxInput.addEventListener("input", updateDisplay);
    updateDisplay();
  }

  // ---- Intellisense ----
  var activeSuggestionIndex = -1;
  var currentSuggestionsList = null;

  function setupIntellisense(input, col) {
    var suggestionsEl = document.createElement("ul");
    suggestionsEl.className = "suggestions hidden";
    input.parentElement.appendChild(suggestionsEl);

    input.addEventListener("focus", function () {
      if (input.value.trim() === "") {
        showSuggestions(input, suggestionsEl, col, "");
      }
    });

    input.addEventListener("input", function () {
      var query = input.value.trim();
      if (query === "") {
        showSuggestions(input, suggestionsEl, col, "");
      } else {
        showSuggestions(input, suggestionsEl, col, query);
      }
    });

    input.addEventListener("keydown", function (e) {
      if (!suggestionsEl.classList.contains("hidden")) {
        var items = suggestionsEl.querySelectorAll("li");
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

    input.addEventListener("blur", function () {
      setTimeout(function () { closeSuggestions(suggestionsEl); }, 200);
    });
  }

  function showSuggestions(input, suggestionsEl, col, query) {
    var values = columnIndex.get(col) || [];
    var matches;
    if (query === "") {
      matches = values.slice(0, MAX_RESULTS);
    } else {
      var lowerQuery = query.toLowerCase();
      matches = values.filter(function (v) { return v.toLowerCase().includes(lowerQuery); }).slice(0, MAX_RESULTS);
    }

    if (matches.length === 0) {
      suggestionsEl.classList.add("hidden");
      suggestionsEl.innerHTML = "";
      activeSuggestionIndex = -1;
      return;
    }

    suggestionsEl.innerHTML = "";
    activeSuggestionIndex = -1;

    matches.forEach(function (val) {
      var li = document.createElement("li");
      if (query !== "") {
        li.innerHTML = highlightMatch(val, query);
      } else {
        li.textContent = val;
      }
      li.dataset.value = val;
      li.addEventListener("mousedown", function (e) {
        e.preventDefault();
        selectSuggestion(input, suggestionsEl, li);
      });
      suggestionsEl.appendChild(li);
    });

    suggestionsEl.classList.remove("hidden");
    currentSuggestionsList = suggestionsEl;
  }

  function highlightMatch(text, query) {
    var lowerText = text.toLowerCase();
    var lowerQuery = query.toLowerCase();
    var idx = lowerText.indexOf(lowerQuery);
    if (idx === -1) return escapeHtml(text);
    var before = text.slice(0, idx);
    var match = text.slice(idx, idx + query.length);
    var after = text.slice(idx + query.length);
    return escapeHtml(before) + "<mark>" + escapeHtml(match) + "</mark>" + escapeHtml(after);
  }

  function highlightItem(items) {
    items.forEach(function (li, i) {
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
    document.querySelectorAll(".suggestions").forEach(function (el) {
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

    var textFilters = {};
    var rangeFilters = {};

    searchFields.querySelectorAll("input[data-type='text']").forEach(function (input) {
      var val = input.value.trim();
      if (val) textFilters[input.dataset.column] = val;
    });

    searchFields.querySelectorAll(".numeric-field").forEach(function (field) {
      var col = field.querySelector("input[data-type='range']").dataset.column;
      var filterMin = parseFloat(field.dataset.filterMin);
      var filterMax = parseFloat(field.dataset.filterMax);
      var dataMin = parseFloat(field.dataset.dataMin);
      var dataMax = parseFloat(field.dataset.dataMax);

      if (filterMin !== dataMin || filterMax !== dataMax) {
        rangeFilters[col] = { min: filterMin, max: filterMax };
      }
    });

    resultMessage.textContent = "";
    resultMessage.className = "";
    resultCount.textContent = "";
    resultTableWrap.innerHTML = "";

    var filtered = csvData.filter(function (row) {
      for (var col in textFilters) {
        var cellValue = (row[col] || "").toLowerCase();
        if (!cellValue.includes(textFilters[col].toLowerCase())) {
          return false;
        }
      }
      for (var rCol in rangeFilters) {
        var raw = (row[rCol] || "").trim();
        var num = Number(raw);
        if (raw === "" || isNaN(num)) {
          return false;
        }
        if (num < rangeFilters[rCol].min || num > rangeFilters[rCol].max) {
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
      shareRow.classList.add("hidden");
      return;
    }

    lastFiltered = filtered;
    resultCount.textContent = filtered.length + " result(s) found";
    shareRow.classList.remove("hidden");
    renderTable(csvColumns, filtered);
  }

  // ---- Clear ----
  clearBtn.addEventListener("click", function () {
    searchFields.querySelectorAll("input[data-type='text']").forEach(function (input) { input.value = ""; });

    searchFields.querySelectorAll(".numeric-field").forEach(function (field) {
      var numInfo = numericColumns.get(field.querySelector("input[data-type='range']").dataset.column);
      if (!numInfo) return;
      var minInput = field.querySelector(".range-min");
      var maxInput = field.querySelector(".range-max");
      minInput.value = numInfo.min;
      maxInput.value = numInfo.max;
      minInput.dispatchEvent(new Event("input"));
      maxInput.dispatchEvent(new Event("input"));
    });

    resultSection.classList.add("hidden");
    closeAllSuggestions();
  });

  // ---- Render table ----
  function renderTable(columns, rows) {
    var html = "<table><thead><tr>";
    columns.forEach(function (col) { html += "<th>" + escapeHtml(col) + "</th>"; });
    html += "</tr></thead><tbody>";
    rows.forEach(function (row) {
      html += "<tr>";
      columns.forEach(function (col) { html += "<td>" + escapeHtml(row[col] || "") + "</td>"; });
      html += "</tr>";
    });
    html += "</tbody></table>";
    resultTableWrap.innerHTML = html;
  }

  function formatFileName(filename) {
    var name = filename.replace(/\.csv$/i, "");
    name = name.replace(/[-_]/g, " ");
    name = name.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    return name;
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Format & Share ----
  function updateFormatToggle() {
    fmtTableBtn.classList.toggle("active", shareFormat === "table");
    fmtCsvBtn.classList.toggle("active", shareFormat === "csv");
  }

  (function initFormatToggle() {
    updateFormatToggle();
    fmtTableBtn.addEventListener("click", function () {
      shareFormat = "table";
      localStorage.setItem("csv-search-format", "table");
      updateFormatToggle();
    });
    fmtCsvBtn.addEventListener("click", function () {
      shareFormat = "csv";
      localStorage.setItem("csv-search-format", "csv");
      updateFormatToggle();
    });
  })();

  function formatAsTextTable(columns, rows) {
    var colWidths = columns.map(function (col) {
      var maxData = rows.reduce(function (max, row) { return Math.max(max, (row[col] || "").length); }, 0);
      return Math.max(col.length, maxData);
    });
    var header = columns.map(function (col, i) { return col.padEnd(colWidths[i]); }).join(" | ");
    var separator = colWidths.map(function (w) { return "-".repeat(w); }).join("-+-");
    var dataLines = rows.map(function (row) {
      return columns.map(function (col, i) { return (row[col] || "").padEnd(colWidths[i]); }).join(" | ");
    });
    return [header, separator].concat(dataLines).join("\n");
  }

  function formatAsCSV(columns, rows) {
    var lines = [columns.map(quoteCsvField).join(",")];
    rows.forEach(function (row) {
      lines.push(columns.map(function (col) { return quoteCsvField(row[col] || ""); }).join(","));
    });
    return lines.join("\n");
  }

  function quoteCsvField(val) {
    var str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function getShareText() {
    if (shareFormat === "csv") {
      return formatAsCSV(csvColumns, lastFiltered);
    }
    return formatAsTextTable(csvColumns, lastFiltered);
  }

  shareBtn.addEventListener("click", function () {
    if (!csvColumns || lastFiltered.length === 0) return;
    var text = getShareText();
    var url = window.location.href;

    if (navigator.share) {
      navigator.share({
        title: "CSV Search and Send Results",
        text: text,
        url: url,
      }).catch(function (err) {
        if (err.name !== "AbortError") {
          fallbackMailto(text);
        }
      });
    } else {
      fallbackMailto(text);
    }
  });

  function fallbackMailto(text) {
    var subject = encodeURIComponent("CSV Search Results");
    var body = encodeURIComponent(text);
    window.open("mailto:?subject=" + subject + "&body=" + body, "_blank");
  }

  // ---- Lazy-load & Download ----
  var libsLoaded = { pdf: false, excel: false, image: false };

  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = url;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function downloadPDF() {
    if (!csvColumns || lastFiltered.length === 0) return;
    if (!libsLoaded.pdf) {
      btnPdf.textContent = "Loading\u2026";
      Promise.all([
        loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"),
        loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js")
      ]).then(function () {
        libsLoaded.pdf = true;
        btnPdf.textContent = "PDF";
        generatePDF();
      }).catch(function () {
        btnPdf.textContent = "PDF";
        alert("Failed to load PDF library. Please try again.");
      });
      return;
    }
    generatePDF();
  }

  function generatePDF() {
    var doc = new window.jspdf.jsPDF();
    doc.text("CSV Search and Send Results", 14, 16);
    doc.autoTable({
      head: [csvColumns.slice()],
      body: lastFiltered.map(function (row) {
        return csvColumns.map(function (col) { return row[col] || ""; });
      }),
      startY: 22,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [59, 130, 246] },
    });
    doc.save("csv-search-results.pdf");
  }

  function downloadExcel() {
    if (!csvColumns || lastFiltered.length === 0) return;
    if (!libsLoaded.excel) {
      btnExcel.textContent = "Loading\u2026";
      loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js").then(function () {
        libsLoaded.excel = true;
        btnExcel.textContent = "Excel";
        generateExcel();
      }).catch(function () {
        btnExcel.textContent = "Excel";
        alert("Failed to load Excel library. Please try again.");
      });
      return;
    }
    generateExcel();
  }

  function generateExcel() {
    var wsData = [csvColumns.slice()];
    lastFiltered.forEach(function (row) {
      wsData.push(csvColumns.map(function (col) { return row[col] || ""; }));
    });
    var ws = XLSX.utils.aoa_to_sheet(wsData);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    XLSX.writeFile(wb, "csv-search-results.xlsx");
  }

  function downloadImage() {
    if (!resultTableWrap || !resultTableWrap.querySelector("table")) return;
    if (!libsLoaded.image) {
      btnImage.textContent = "Loading\u2026";
      loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js").then(function () {
        libsLoaded.image = true;
        btnImage.textContent = "Image";
        generateImage();
      }).catch(function () {
        btnImage.textContent = "Image";
        alert("Failed to load image library. Please try again.");
      });
      return;
    }
    generateImage();
  }

  function generateImage() {
    html2canvas(resultTableWrap).then(function (canvas) {
      var link = document.createElement("a");
      link.download = "csv-search-results.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    });
  }

  btnPdf.addEventListener("click", downloadPDF);
  btnExcel.addEventListener("click", downloadExcel);
  btnImage.addEventListener("click", downloadImage);

  // ---- Footer year ----
  var footerYear = document.getElementById("footer-year");
  if (footerYear) {
    footerYear.textContent = new Date().getFullYear();
  }

  // ---- Auto-load on init ----
  if (autoLoadCheck.checked) {
    loadFromGitHub();
  }
})();