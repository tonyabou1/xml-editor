export const starterXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA 1.3 Topic//EN" "topic.dtd">
<topic id="browser-xml-editor">
  <title>Browser XML Editor</title>
  <shortdesc>Edit DITA topic content in a structured WYSIWYG surface.</shortdesc>
  <body>
    <section id="overview">
      <title>Overview</title>
      <p>This editor keeps XML source and the visual document synchronized. See <xref href="related-topic.dita">sample related topic</xref>.</p>
      <note type="tip">Use the insert bar to add DITA-safe elements.</note>
      <fig id="sample-figure">
        <title>Sample figure</title>
        <image href="../assets/sample-figure.png" alt="Placeholder DITA image"/>
      </fig>
    </section>
    <section id="workflow">
      <title>Workflow</title>
      <p>Validate the document, format the XML, and export the topic when ready.</p>
      <ul>
        <li>Edit the rendered DITA topic.</li>
        <li>Inspect the source XML.</li>
        <li>Fix schema issues before publishing.</li>
      </ul>
    </section>
  </body>
</topic>`;

export const brokenDitaXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA 1.3 Topic//EN" "topic.dtd">
<topic id="broken-validation-sample">
  <body>
    <p>This body appears before the required title, so DITA-OT should report a schema error.</p>
  </body>
  <title>Broken validation sample</title>
</topic>`;

export const relatedTopicXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA 1.3 Topic//EN" "topic.dtd">
<topic id="related-topic">
  <title>Sample related topic</title>
  <shortdesc>A valid referenced topic used by the starter sample.</shortdesc>
  <body>
    <p>This topic exists so xref validation can resolve a real DITA target.</p>
  </body>
</topic>`;

export const aiReviewSampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE concept PUBLIC "-//OASIS//DTD DITA 1.3 Concept//EN" "concept.dtd">
<concept id="ai-review-sample">
  <title>AI review sample</title>
  <conbody>
    <p>This paragraph is intentionally long so the ambient AI review can flag it as a candidate for splitting into smaller DITA blocks. It describes a publishing workflow where authors update release notes, validate references, coordinate with reviewers, confirm image links, verify conref targets, prepare branch changes, and publish the final topic after the content passes all required checks. The paragraph keeps going so it crosses the configured threshold and creates a useful test case for the first review foundation.</p>
    <note>This note intentionally has no type attribute so the AI Review can suggest adding type="note".</note>
  </conbody>
</concept>`;

export const sampleImagePreviewUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAACWCAYAAABkW7XSAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAANSURBVHhe7cEBAQAAAMKg9U9tDB8gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgYwEoAAABP9sEWAAAAABJRU5ErkJggg==";
