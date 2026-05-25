type ValidationIssue = {
  level?: string;
  file?: string;
  line?: number;
  column?: number;
  message?: string;
  raw?: string;
};

type ValidationResult = {
  ok?: boolean;
  engine?: string;
  output?: string;
  issues?: ValidationIssue[];
  specializationGeneralization?: Array<{
    path: string;
    specializations?: Array<{ name: string; baseName: string }>;
  }>;
};

export function createValidationReportContent({
  fileName,
  filePath,
  result,
  validatedAt,
  note = "",
}: {
  fileName: string;
  filePath: string;
  result: ValidationResult;
  validatedAt: string;
  note?: string;
}) {
  const issues = Array.isArray(result.issues) ? result.issues : [];
  const output = String(result.output || "").trim();
  const lines = [
    `Validation report: ${fileName}`,
    `Validated: ${validatedAt}`,
    `Entry: ${filePath}`,
    `Engine: ${result.engine || "unknown"}`,
    `Status: ${result.ok ? "Valid" : "Invalid"}`,
    "",
  ];

  if (issues.length) {
    lines.push("Issues:");
    issues.forEach((issue, index) => {
      const location = [
        issue.file,
        issue.line ? `line ${issue.line}` : "",
        issue.column ? `column ${issue.column}` : "",
      ].filter(Boolean).join(", ");
      lines.push(`${index + 1}. [${issue.level || "error"}] ${issue.message || "Validation issue"}`);
      if (location) {
        lines.push(`   Location: ${location}`);
      }
      if (issue.raw && issue.raw !== issue.message) {
        lines.push(`   DITA-OT: ${issue.raw}`);
      }
    });
  } else if (result.ok) {
    lines.push("No DITA validation issues were reported.");
  } else {
    lines.push("DITA-OT reported a validation failure without structured issues.");
  }

  if (Array.isArray(result.specializationGeneralization) && result.specializationGeneralization.length) {
    lines.push("", "Specialization validation bridge:");
    result.specializationGeneralization.forEach((entry) => {
      const mapped = (entry.specializations || [])
        .map((specialization) => `<${specialization.name}> as <${specialization.baseName}>`)
        .join(", ");
      lines.push(`- ${entry.path}: ${mapped}`);
    });
  }

  if (output) {
    lines.push("", "Raw DITA-OT output:", output);
  }

  if (note) {
    lines.push("", note);
  }

  return lines.join("\n");
}
