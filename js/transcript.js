// The transcript: sentence rows (original + translation) and section headings,
// all editable in place, plus an outline of the sections for review.
// Exporting is done by printing this part of the page (see the print styles).

// Lets the user type into an element; onCommit runs when they finish (Enter or
// clicking away) with a non-empty change. Escape or an empty result undoes the edit.
function makeEditable(element, onCommit) {
  element.contentEditable = 'plaintext-only';
  let textBeforeEdit = '';

  element.addEventListener('focus', () => {
    textBeforeEdit = element.textContent;
  });
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      element.blur();
    } else if (event.key === 'Escape') {
      element.textContent = textBeforeEdit;
      element.blur();
    }
  });
  element.addEventListener('blur', () => {
    const editedText = element.textContent.trim();
    if (editedText === textBeforeEdit.trim()) return;
    if (editedText === '' && !element.dataset.allowEmpty) {
      element.textContent = textBeforeEdit;
      return;
    }
    element.textContent = editedText;
    onCommit(editedText);
  });
}

function createButton(className, label, text) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.textContent = text;
  return button;
}

export function createTranscript({ rowsEl, outlineEl, outlineListEl, translateText, onChange }) {
  function sections() {
    return [...rowsEl.querySelectorAll('.section')];
  }

  function rows() {
    return [...rowsEl.querySelectorAll('.row')];
  }

  function renderOutline() {
    const allSections = sections();
    outlineEl.hidden = allSections.length === 0;
    outlineListEl.replaceChildren(
      ...allSections.map((section, index) => {
        const title = section.querySelector('.section-title').textContent || `Untitled section`;
        const link = createButton('outline-link', `Jump to section ${index + 1}`, `${index + 1}. ${title}`);
        link.addEventListener('click', () => section.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        const item = document.createElement('li');
        item.appendChild(link);
        return item;
      }),
    );
  }

  function changed() {
    renderOutline();
    renderSpeakerTags();
    onChange();
  }

  // ---------- Speakers ----------

  // Names keyed by "<recording>:<speaker number>": each recording or upload
  // numbers its own speakers.
  const speakerNames = new Map();
  let speakerRecordingCount = 0;
  const SPEAKER_COLORS = 6;

  function createSpeakerTag() {
    const tag = document.createElement('span');
    tag.className = 'speaker-tag';
    tag.title = 'Click to rename this speaker everywhere';
    makeEditable(tag, (name) => renameSpeaker(tag.dataset.speakerKey, name));
    return tag;
  }

  // Renaming a speaker to the name of another speaker in the same recording
  // merges them: their lines become one person's (for when one voice was split).
  function renameSpeaker(key, name) {
    const recording = key.split(':')[0];
    const sameName = [...speakerNames].find(
      ([otherKey, otherName]) =>
        otherKey !== key && otherKey.startsWith(`${recording}:`) && otherName.toLowerCase() === name.toLowerCase(),
    );
    if (sameName) {
      const [otherKey] = sameName;
      const otherColor = rows().find((row) => row.dataset.speaker === otherKey)?.dataset.speakerColor;
      for (const row of rows()) {
        if (row.dataset.speaker !== key) continue;
        row.dataset.speaker = otherKey;
        if (otherColor !== undefined) row.dataset.speakerColor = otherColor;
      }
      speakerNames.delete(key);
    } else {
      speakerNames.set(key, name);
    }
    renderSpeakerTags();
  }

  // A tag with the speaker's name starts each run of lines by the same person.
  function renderSpeakerTags() {
    let previousKey = null;
    for (const row of rows()) {
      const key = row.dataset.speaker ?? null;
      let tag = row.querySelector('.speaker-tag');
      if (key !== null && key !== previousKey) {
        if (!tag) {
          tag = createSpeakerTag();
          row.querySelector('.time').after(tag);
        }
        tag.dataset.speakerKey = key;
        tag.dataset.color = row.dataset.speakerColor;
        if (document.activeElement !== tag) tag.textContent = speakerNames.get(key);
      } else {
        tag?.remove();
      }
      previousKey = key;
    }
  }

  // speakers: a speaker number for each row; names: indexed by speaker number.
  function assignSpeakers(rowsToLabel, speakers, names) {
    speakerRecordingCount++;
    rowsToLabel.forEach((row, index) => {
      row.dataset.speaker = `${speakerRecordingCount}:${speakers[index]}`;
      row.dataset.speakerColor = String(speakers[index] % SPEAKER_COLORS);
    });
    names.forEach((name, speaker) => speakerNames.set(`${speakerRecordingCount}:${speaker}`, name));
    renderSpeakerTags();
  }

  // ---------- Translation ----------

  // Each edit bumps the row's version, so a slow, outdated translation never
  // overwrites a newer one.
  async function translateRow(row, placeholder = 'Translating…') {
    const cell = row.querySelector('.translation');
    const text = row.querySelector('.original').textContent;
    const version = String(Number(row.dataset.translationVersion ?? 0) + 1);
    row.dataset.translationVersion = version;
    const isCurrent = () => row.dataset.translationVersion === version;

    cell.classList.remove('failed');
    cell.classList.add('pending');
    cell.textContent = placeholder;
    try {
      const translatedText = await translateText(text, row.dataset.targetLanguage);
      if (!isCurrent()) return;
      cell.textContent = translatedText;
      cell.lang = row.dataset.targetLanguage;
    } catch {
      if (!isCurrent()) return;
      cell.textContent = 'Translation failed';
      cell.classList.add('failed');
    } finally {
      if (isCurrent()) cell.classList.remove('pending');
    }
  }

  // ---------- Sections ----------

  function createSection() {
    const section = document.createElement('div');
    section.className = 'section';

    const number = document.createElement('span');
    number.className = 'section-number';
    number.setAttribute('aria-hidden', 'true');

    const title = document.createElement('h2');
    title.className = 'section-title';
    title.dataset.placeholder = 'Name this section (e.g. "Recursion: base case")';
    title.dataset.allowEmpty = 'true';
    makeEditable(title, () => {
      title.dataset.editedByUser = 'true';
      title.classList.remove('naming');
      renderOutline();
    });

    const removeButton = createButton('section-remove', 'Remove this section heading (keeps the sentences)', '×');
    removeButton.addEventListener('click', () => {
      section.remove();
      changed();
    });

    section.append(number, title, removeButton);
    return section;
  }

  function insertSection(beforeElement, { focus = true } = {}) {
    const section = createSection();
    if (beforeElement) {
      beforeElement.before(section);
    } else {
      rowsEl.appendChild(section);
    }
    changed();
    if (focus) section.querySelector('.section-title').focus();
    return section;
  }

  // Adds a heading whose title is filled in later (by automatic organizing).
  function addPendingSectionBefore(row) {
    const section = insertSection(row, { focus: false });
    const title = section.querySelector('.section-title');
    title.textContent = 'Naming…';
    title.classList.add('naming');
    renderOutline();
    return {
      setTitle(text) {
        if (!section.isConnected || title.dataset.editedByUser || document.activeElement === title) return;
        title.textContent = text;
        title.classList.remove('naming');
        renderOutline();
      },
    };
  }

  // ---------- Sentence rows ----------

  // provisionalTranslation is the live translation shown while the sentence was
  // still being spoken; it stays (greyed) until the final translation arrives.
  function addLine(text, { timeLabel, elapsedMs, targetLanguage, provisionalTranslation }) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.targetLanguage = targetLanguage;
    row.dataset.elapsedMs = String(elapsedMs);

    const side = document.createElement('div');
    side.className = 'row-side';
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = timeLabel;
    const flagButton = createButton('row-flag', 'Flag this sentence for review', '☆');
    flagButton.setAttribute('aria-pressed', 'false');
    flagButton.addEventListener('click', () => toggleFlag(row));
    const sectionButton = createButton('row-section', 'Start a new section at this sentence', '¶');
    sectionButton.addEventListener('click', () => insertSection(row));
    const actions = document.createElement('span');
    actions.className = 'row-actions';
    actions.append(flagButton, sectionButton);
    side.append(time, actions);

    const original = document.createElement('div');
    original.className = 'original';
    original.lang = 'en';
    original.textContent = text;
    makeEditable(original, () => translateRow(row));

    const translation = document.createElement('div');
    translation.className = 'translation';
    translation.dir = 'auto';
    makeEditable(translation, () => {
      translation.classList.remove('failed');
    });

    row.append(side, original, translation);
    rowsEl.appendChild(row);
    changed();
    translateRow(row, provisionalTranslation || undefined);
    return row;
  }


  // A labelled line marking where an uploaded recording's transcript begins.
  function addDivider(label) {
    const divider = document.createElement('div');
    divider.className = 'file-divider';
    divider.textContent = label;
    rowsEl.appendChild(divider);
    changed();
    return divider;
  }

  function removeLines(rowsToRemove) {
    for (const row of rowsToRemove) row.remove();
    changed();
  }

  // Replaces a line's text and translates it again.
  // The old translation stays (dimmed) until the new one is ready, so a line
  // that grows doesn't flash "Translating…".
  function setLineText(row, text) {
    row.querySelector('.original').textContent = text;
    const cell = row.querySelector('.translation');
    const currentTranslation = cell.classList.contains('failed') ? '' : cell.textContent;
    translateRow(row, currentTranslation || 'Translating…');
  }

  // Adds text to the end of a line (with no space: it finishes a cut-off word).
  function appendToLine(row, text) {
    setLineText(row, row.querySelector('.original').textContent + text);
  }

  // The sentences from firstRow (or from the start) onward, for automatic organizing.
  function linesFrom(firstRow) {
    const allRows = rows();
    const startIndex = firstRow ? allRows.indexOf(firstRow) : 0;
    if (startIndex < 0) return [];
    return allRows.slice(startIndex).map((row) => ({
      row,
      text: row.querySelector('.original').textContent,
      elapsedMs: Number(row.dataset.elapsedMs),
    }));
  }

  function toggleFlag(row) {
    const isFlagged = row.classList.toggle('flagged');
    const flagButton = row.querySelector('.row-flag');
    flagButton.textContent = isFlagged ? '★' : '☆';
    flagButton.setAttribute('aria-pressed', String(isFlagged));
  }

  return {
    addLine,
    addSection: () => insertSection(null),
    flagLastLine() {
      const lastRow = rows().at(-1);
      if (lastRow) toggleFlag(lastRow);
    },
    addDivider,
    addPendingSectionBefore,
    appendToLine,
    assignSpeakers,
    setLineText,
    linesFrom,
    removeLines,
    hasContent: () => rowsEl.children.length > 0,
    hasLines: () => rows().length > 0,
    hasSections: () => sections().length > 0,
    removeAllSections() {
      for (const section of sections()) section.remove();
      changed();
    },
    clear() {
      rowsEl.replaceChildren();
      speakerNames.clear();
      changed();
    },
  };
}
