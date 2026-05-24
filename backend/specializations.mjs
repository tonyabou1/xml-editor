import { getPool, query } from "./db.mjs";

const xmlNamePattern = /^[A-Za-z_][A-Za-z0-9._-]*$/;
const moduleNamePattern = /^[A-Za-z_][A-Za-z0-9._-]*$/;
const specializationKinds = new Set(["element", "documentType"]);

function firstOrganizationId(account) {
  const membership = account?.memberships?.[0];
  if (!membership?.organization_id) {
    throw Object.assign(new Error("No organization membership is available for specialization management."), {
      statusCode: 403,
    });
  }
  return membership.organization_id;
}

function assertXmlName(value, label) {
  const name = String(value || "").trim();
  if (!xmlNamePattern.test(name)) {
    throw Object.assign(new Error(`${label} must be a valid XML name.`), { statusCode: 400 });
  }
  return name;
}

function assertModuleName(value) {
  const name = String(value || "").trim();
  if (!moduleNamePattern.test(name)) {
    throw Object.assign(new Error("moduleName must be a valid specialization module name."), { statusCode: 400 });
  }
  return name;
}

function normalizeAttribute(attribute) {
  if (typeof attribute === "string") {
    return { name: assertXmlName(attribute, "Attribute name"), required: false, defaultValue: "" };
  }

  return {
    name: assertXmlName(attribute?.name, "Attribute name"),
    required: Boolean(attribute?.required),
    defaultValue: attribute?.defaultValue == null ? "" : String(attribute.defaultValue),
    values: Array.isArray(attribute?.values)
      ? attribute.values.map((value) => String(value).trim()).filter(Boolean)
      : [],
  };
}

function normalizePayload(payload = {}) {
  const kind = String(payload.kind || "element").trim();
  if (!specializationKinds.has(kind)) {
    throw Object.assign(new Error("kind must be element or documentType."), { statusCode: 400 });
  }

  const name = assertXmlName(payload.name, "Specialization name");
  const baseName = assertXmlName(payload.baseName || payload.base_name, "Base name");
  const moduleName = assertModuleName(payload.moduleName || payload.module_name || `${name}-module`);
  const addedAttributes = Array.isArray(payload.addedAttributes)
    ? payload.addedAttributes.map(normalizeAttribute)
    : [];
  const allowedDocumentTypes = Array.isArray(payload.allowedDocumentTypes)
    ? payload.allowedDocumentTypes.map((type) => assertXmlName(type, "Document type"))
    : [];
  const authoringProfile = payload.authoringProfile && typeof payload.authoringProfile === "object"
    ? {
        enabled: Boolean(payload.authoringProfile.enabled),
        visibleElements: Array.isArray(payload.authoringProfile.visibleElements)
          ? [...new Set(payload.authoringProfile.visibleElements.map((type) => assertXmlName(type, "Visible element")))].sort()
          : [],
      }
    : { enabled: false, visibleElements: [] };

  return {
    kind,
    name,
    baseName,
    moduleName,
    addedAttributes,
    allowedDocumentTypes,
    authoringProfile,
    description: String(payload.description || "").trim(),
  };
}

function baseClassAncestor(baseName) {
  if (["concept", "task", "reference"].includes(baseName)) {
    return `topic/${baseName}`;
  }
  if (baseName === "map" || baseName === "topicref") {
    return `map/${baseName}`;
  }
  return `topic/${baseName}`;
}

function buildClassChain(definition) {
  return `- ${baseClassAncestor(definition.baseName)} ${definition.moduleName}/${definition.name} `;
}

function inheritedElementFromSchema(schema, definition) {
  const base = schema?.elements?.[definition.baseName];
  if (!base) {
    throw Object.assign(new Error(`Base element <${definition.baseName}> was not found in the loaded DITA RNG schema.`), {
      statusCode: 400,
    });
  }

  const inheritedAttributes = Array.isArray(base.attributes) ? base.attributes : [];
  const extraAttributes = definition.addedAttributes.map((attribute) => attribute.name);
  const attributes = [...new Set([...inheritedAttributes, ...extraAttributes, "class"])].sort();

  return {
    name: definition.name,
    baseName: definition.baseName,
    moduleName: definition.moduleName,
    kind: definition.kind,
    classChain: buildClassChain(definition),
    inherits: {
      content: base.content || [],
      contentModel: base.contentModel || null,
      contentRefs: base.contentRefs || [],
      allowsText: Boolean(base.allowsText),
      sourceFiles: base.sourceFiles || [],
    },
    attributes,
    addedAttributes: definition.addedAttributes,
    allowedDocumentTypes: definition.allowedDocumentTypes,
    authoringProfile: definition.authoringProfile,
  };
}

function buildRngPreview(definition, inheritedElement) {
  const extraAttributes = definition.addedAttributes
    .map((attribute) => {
      const valuePattern = attribute.values?.length
        ? [
            "      <choice>",
            ...attribute.values.map((value) => `        <value>${value}</value>`),
            "      </choice>",
          ].join("\n")
        : "      <text/>";
      const wrapperStart = attribute.required ? "" : "    <optional>\n";
      const wrapperEnd = attribute.required ? "" : "\n    </optional>";
      return `${wrapperStart}    <attribute name="${attribute.name}">\n${valuePattern}\n    </attribute>${wrapperEnd}`;
    })
    .join("\n");

  return [
    `<!-- Preview module for ${definition.kind} specialization ${definition.name}. -->`,
    `<!-- Inherits content model from ${definition.baseName}; DITA-OT validation remains final authority. -->`,
    `<define name="${definition.name}.element">`,
    `  <element name="${definition.name}">`,
    `    <ref name="${definition.name}.attlist"/>`,
    `    <ref name="${definition.baseName}.content"/>`,
    "  </element>",
    "</define>",
    "",
    `<define name="${definition.name}.attlist">`,
    `  <ref name="${definition.baseName}.attlist"/>`,
    `  <attribute name="class">`,
    `    <value>${inheritedElement.classChain}</value>`,
    "  </attribute>",
    extraAttributes,
    "</define>",
  ].filter(Boolean).join("\n");
}

async function ensureSchemaVersion(client, organizationId, userId) {
  const result = await client.query(
    `
      insert into schema_versions (organization_id, name, dita_version, status, uploaded_by)
      values ($1, 'DITA 1.3 Base', '1.3', 'valid', $2)
      on conflict (organization_id, name)
      do update set status = excluded.status, updated_at = now()
      returning id, name, dita_version, status
    `,
    [organizationId, userId],
  );
  return result.rows[0];
}

export async function previewSpecialization({ account, schema, payload }) {
  const organizationId = firstOrganizationId(account);
  const definition = normalizePayload(payload);
  const inheritedElement = inheritedElementFromSchema(schema, definition);

  return {
    organizationId,
    definition,
    inheritedElement,
    rngPreview: buildRngPreview(definition, inheritedElement),
  };
}

export async function listSpecializations(account) {
  const organizationId = firstOrganizationId(account);
  const result = await query(
    `
      select
        specialization_definitions.id,
        specialization_definitions.kind,
        specialization_definitions.name,
        specialization_definitions.base_name as "baseName",
        specialization_definitions.module_name as "moduleName",
        specialization_definitions.class_chain as "classChain",
        specialization_definitions.definition_json as "definition",
        specialization_definitions.status,
        specialization_definitions.created_at as "createdAt",
        specialization_definitions.updated_at as "updatedAt",
        schema_versions.name as "schemaVersionName",
        schema_versions.dita_version as "ditaVersion"
      from specialization_definitions
      join schema_versions on schema_versions.id = specialization_definitions.schema_version_id
      where specialization_definitions.organization_id = $1
      order by specialization_definitions.updated_at desc, specialization_definitions.name
    `,
    [organizationId],
  );

  return { specializations: result.rows };
}

export async function saveSpecialization({ account, schema, payload }) {
  const pool = getPool();
  const client = await pool.connect();
  const organizationId = firstOrganizationId(account);
  const preview = await previewSpecialization({ account, schema, payload });
  const specializationId = payload?.id ? String(payload.id) : "";

  try {
    await client.query("begin");
    const schemaVersion = await ensureSchemaVersion(client, organizationId, account.user.id);
    const definitionJson = JSON.stringify({
      ...preview.definition,
      inheritedElement: preview.inheritedElement,
      rngPreview: preview.rngPreview,
    });
    const values = [
      schemaVersion.id,
      organizationId,
      preview.definition.kind,
      preview.definition.name,
      preview.definition.baseName,
      preview.definition.moduleName,
      preview.inheritedElement.classChain,
      definitionJson,
      account.user.id,
    ];
    const result = specializationId
      ? await client.query(
          `
            update specialization_definitions
            set
              schema_version_id = $1,
              kind = $3,
              name = $4,
              base_name = $5,
              module_name = $6,
              class_chain = $7,
              definition_json = $8,
              status = 'draft',
              updated_at = now()
            where id = $10::uuid
              and organization_id = $2
            returning id, kind, name, base_name as "baseName", module_name as "moduleName", class_chain as "classChain", definition_json as "definition", status, created_at as "createdAt", updated_at as "updatedAt"
          `,
          [...values, specializationId],
        )
      : await client.query(
          `
            insert into specialization_definitions (
              schema_version_id,
              organization_id,
              kind,
              name,
              base_name,
              module_name,
              class_chain,
              definition_json,
              status,
              created_by
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9)
            on conflict (schema_version_id, kind, name)
            do update set
              base_name = excluded.base_name,
              module_name = excluded.module_name,
              class_chain = excluded.class_chain,
              definition_json = excluded.definition_json,
              status = 'draft',
              updated_at = now()
            returning id, kind, name, base_name as "baseName", module_name as "moduleName", class_chain as "classChain", definition_json as "definition", status, created_at as "createdAt", updated_at as "updatedAt"
          `,
          values,
        );

    if (!result.rowCount) {
      throw Object.assign(new Error("Specialization draft was not found for this organization."), { statusCode: 404 });
    }

    await client.query("commit");
    return {
      specialization: result.rows[0],
      inheritedElement: preview.inheritedElement,
      rngPreview: preview.rngPreview,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function validateSpecializationDraft({ account, schema, id }) {
  const organizationId = firstOrganizationId(account);
  const specializationId = String(id || "").trim();
  if (!specializationId) {
    throw Object.assign(new Error("Specialization id is required."), { statusCode: 400 });
  }

  const existing = await query(
    `
      select
        id,
        kind,
        name,
        base_name as "baseName",
        module_name as "moduleName",
        class_chain as "classChain",
        definition_json as "definition",
        status
      from specialization_definitions
      where id = $1
        and organization_id = $2
      limit 1
    `,
    [specializationId, organizationId],
  );

  if (!existing.rowCount) {
    throw Object.assign(new Error("Specialization draft was not found for this organization."), { statusCode: 404 });
  }

  const row = existing.rows[0];
  const payload = {
    id: row.id,
    kind: row.kind,
    name: row.name,
    baseName: row.baseName,
    moduleName: row.moduleName,
    addedAttributes: row.definition?.addedAttributes || [],
    allowedDocumentTypes: row.definition?.allowedDocumentTypes || [],
    description: row.definition?.description || "",
  };
  const preview = await previewSpecialization({ account, schema, payload });
  const validDocumentSpecializations = await query(
    `
      select name
      from specialization_definitions
      where organization_id = $1
        and kind = 'documentType'
        and status = 'valid'
    `,
    [organizationId],
  );
  const validDocumentTypeNames = new Set([
    ...Object.keys(schema?.elements || {}).filter((name) => ["topic", "concept", "task", "reference", "map"].includes(name)),
    ...(schema?.rootElements || []),
    ...validDocumentSpecializations.rows.map((item) => item.name),
  ]);
  const invalidScopeTypes = preview.definition.allowedDocumentTypes.filter((documentType) => !validDocumentTypeNames.has(documentType));
  const checks = [
    {
      ok: true,
      label: "XML names",
      message: "Specialization name, base name, module name, and attributes are valid XML names.",
    },
    {
      ok: Boolean(schema?.elements?.[preview.definition.baseName]),
      label: "Base element",
      message: `<${preview.definition.baseName}> exists in the loaded DITA 1.3 RNG schema index.`,
    },
    {
      ok: Boolean(preview.inheritedElement.classChain),
      label: "Class chain",
      message: preview.inheritedElement.classChain,
    },
    {
      ok: Boolean(preview.rngPreview.includes(`${preview.definition.name}.element`)),
      label: "RNG preview",
      message: "Generated local RNG preview references the specialized element definition.",
    },
    {
      ok: invalidScopeTypes.length === 0,
      label: "Document scope",
      message: invalidScopeTypes.length
        ? `Unknown document type scope: ${invalidScopeTypes.join(", ")}.`
        : preview.definition.allowedDocumentTypes.length
          ? `Scoped to ${preview.definition.allowedDocumentTypes.join(", ")}.`
          : "Global specialization scope.",
    },
  ];
  const ok = checks.every((check) => check.ok);
  const status = ok ? "valid" : "invalid";
  const validationReport = {
    validatedAt: new Date().toISOString(),
    mode: "local-specialization-definition",
    note: "This validates the local specialization definition and editor overlay. Production DITA-OT shell generation is a separate publishing step.",
    checks,
  };

  const updateResult = await query(
    `
      update specialization_definitions
      set
        class_chain = $1,
        definition_json = $2,
        status = $3,
        updated_at = now()
      where id = $4
        and organization_id = $5
      returning id, kind, name, base_name as "baseName", module_name as "moduleName", class_chain as "classChain", definition_json as "definition", status, created_at as "createdAt", updated_at as "updatedAt"
    `,
    [
      preview.inheritedElement.classChain,
      JSON.stringify({
        ...preview.definition,
        inheritedElement: preview.inheritedElement,
        rngPreview: preview.rngPreview,
        validationReport,
      }),
      status,
      specializationId,
      organizationId,
    ],
  );

  return {
    ok,
    specialization: updateResult.rows[0],
    inheritedElement: preview.inheritedElement,
    rngPreview: preview.rngPreview,
    report: validationReport,
  };
}
