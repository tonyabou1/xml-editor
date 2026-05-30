import { getPool, query } from "./db.mjs";

const tokenKeyPattern = /^[a-z][a-z0-9.-]*$/;
const classKeyPattern = /^[A-Za-z_][A-Za-z0-9._-]*$/;
const tokenTypes = new Set([
  "color",
  "space",
  "radius",
  "border",
  "shadow",
  "font-size",
  "font-family",
  "font-weight",
  "number",
  "asset",
]);
const styleClassTargets = new Set(["container", "slot", "dita", "both"]);

const defaultDesignTokens = [
  ["color.brand.primary", "color", "#5454c9", "Primary interaction color."],
  ["color.brand.accent", "color", "#2f64b5", "Secondary authoring accent."],
  ["color.surface.page", "color", "#ffffff", "Template page surface."],
  ["color.surface.panel", "color", "#f0f1f3", "Panel and tool surface."],
  ["color.border.soft", "color", "#c7d3e7", "Soft structural border."],
  ["color.text.primary", "color", "#172033", "Primary readable text."],
  ["color.text.muted", "color", "#667085", "Secondary text."],
  ["space.panel", "space", "12px", "Standard panel inset."],
  ["space.region", "space", "14px", "Default template region padding."],
  ["radius.region", "radius", "8px", "Default region radius."],
  ["font.family.body", "font-family", "Inter", "Default body font family."],
  ["font.size.body", "font-size", "13px", "Default body font size."],
  ["font.size.heading", "font-size", "22px", "Default heading font size."],
  ["font.weight.regular", "font-weight", "400", "Regular text weight."],
  ["font.weight.medium", "font-weight", "500", "Medium text weight."],
  ["font.weight.semibold", "font-weight", "600", "Semibold text weight."],
  ["font.weight.bold", "font-weight", "700", "Bold text weight."],
  ["shadow.soft.color", "color", "#23406f", "Soft shadow source color."],
];

const defaultStyleClasses = [
  {
    classKey: "af-container-soft",
    displayName: "Soft Container",
    description: "Reusable white container with a subtle border.",
    appliesTo: "container",
    style: {
      backgroundColor: "color.surface.page",
      borderColor: "color.border.soft",
      borderRadius: "radius.region",
      borderWidth: 1,
      padding: "space.region",
      shadowPreset: "none",
    },
    textStyle: {
      color: "color.text.primary",
      fontFamily: "font.family.body",
      fontSize: "font.size.body",
      fontWeight: "font.weight.semibold",
    },
  },
  {
    classKey: "af-container-hero",
    displayName: "Hero Container",
    description: "Soft gradient container for opening title regions.",
    appliesTo: "container",
    style: {
      fillMode: "gradient",
      backgroundColor: "#eef5ff",
      gradientFrom: "#eef5ff",
      gradientTo: "#fff7ed",
      borderColor: "color.border.soft",
      borderRadius: "radius.region",
      borderWidth: 1,
      padding: "space.region",
      shadowPreset: "soft",
      shadowColor: "shadow.soft.color",
      shadowOpacity: 14,
    },
    textStyle: {
      color: "color.text.primary",
      fontFamily: "font.family.body",
      fontSize: "font.size.body",
      fontWeight: "font.weight.semibold",
    },
  },
  {
    classKey: "af-slot-heading",
    displayName: "Heading Slot",
    description: "Large title text for prominent template slots.",
    appliesTo: "slot",
    style: {
      backgroundColor: "transparent",
      borderColor: "color.border.soft",
      borderRadius: "radius.region",
      borderWidth: 1,
      padding: 8,
    },
    textStyle: {
      color: "color.text.primary",
      fontFamily: "font.family.body",
      fontSize: "font.size.heading",
      fontWeight: "font.weight.bold",
      textAlign: "left",
    },
  },
  {
    classKey: "af-slot-muted",
    displayName: "Muted Slot",
    description: "Secondary text style for summaries and metadata.",
    appliesTo: "slot",
    style: {
      backgroundColor: "transparent",
      borderColor: "color.border.soft",
      borderRadius: "radius.region",
      borderWidth: 1,
      padding: 8,
    },
    textStyle: {
      color: "color.text.muted",
      fontFamily: "font.family.body",
      fontSize: "font.size.body",
      fontWeight: "font.weight.medium",
      textAlign: "left",
    },
  },
];

function primaryMembership(account) {
  const membership = account?.memberships?.[0];
  if (!membership?.organization_id || !membership?.team_id) {
    throw Object.assign(new Error("No team membership is available for design tokens."), {
      statusCode: 403,
    });
  }
  return membership;
}

function normalizeTokenKey(value) {
  const tokenKey = String(value || "").trim();
  if (!tokenKeyPattern.test(tokenKey)) {
    throw Object.assign(new Error("token_key must use lowercase dot notation."), { statusCode: 400 });
  }
  return tokenKey;
}

function normalizeClassKey(value) {
  const classKey = String(value || "").trim();
  if (!classKeyPattern.test(classKey)) {
    throw Object.assign(new Error("class_key must be a valid outputclass/XML token."), { statusCode: 400 });
  }
  return classKey;
}

function normalizeJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function normalizeToken(raw = {}) {
  const rawTokenType = String(raw.type || raw.tokenType || "").trim();
  const tokenType = rawTokenType === "font"
    ? "font-family"
    : rawTokenType === "typography"
      ? "font-size"
      : rawTokenType;
  if (!tokenTypes.has(tokenType)) {
    throw Object.assign(new Error("token_type is not supported."), { statusCode: 400 });
  }
  return {
    key: normalizeTokenKey(raw.key || raw.tokenKey),
    type: tokenType,
    value: String(raw.value ?? raw.tokenValue ?? "").trim(),
    description: String(raw.description || "").trim(),
  };
}

function normalizeStyleClass(raw = {}) {
  const appliesTo = String(raw.appliesTo || raw.applies_to || "both").trim();
  if (!styleClassTargets.has(appliesTo)) {
    throw Object.assign(new Error("applies_to is not supported."), { statusCode: 400 });
  }
  return {
    key: normalizeClassKey(raw.key || raw.classKey),
    displayName: String(raw.displayName || raw.display_name || raw.key || raw.classKey || "").trim(),
    description: String(raw.description || "").trim(),
    appliesTo,
    style: normalizeJsonObject(raw.style || raw.style_json),
    textStyle: normalizeJsonObject(raw.textStyle || raw.text_style_json),
  };
}

async function ensureTeamDesignSystemSeed(account) {
  const membership = primaryMembership(account);
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    for (const [tokenKey, tokenType, tokenValue, description] of defaultDesignTokens) {
      await client.query(
        `
          insert into team_design_tokens (
            organization_id,
            team_id,
            token_key,
            token_type,
            token_value,
            description,
            created_by,
            updated_by
          )
          values ($1, $2, $3, $4, $5, $6, $7, $7)
          on conflict (team_id, token_key) do nothing
        `,
        [membership.organization_id, membership.team_id, tokenKey, tokenType, tokenValue, description, account.user.id],
      );
    }

    for (const styleClass of defaultStyleClasses) {
      await client.query(
        `
          insert into team_style_classes (
            organization_id,
            team_id,
            class_key,
            display_name,
            description,
            applies_to,
            style_json,
            text_style_json,
            created_by,
            updated_by
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
          on conflict (team_id, class_key) do nothing
        `,
        [
          membership.organization_id,
          membership.team_id,
          styleClass.classKey,
          styleClass.displayName,
          styleClass.description,
          styleClass.appliesTo,
          JSON.stringify(styleClass.style),
          JSON.stringify(styleClass.textStyle),
          account.user.id,
        ],
      );
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function listTeamDesignSystem(account) {
  const membership = primaryMembership(account);
  await ensureTeamDesignSystemSeed(account);

  const [tokenResult, classResult] = await Promise.all([
    query(
      `
        select id, token_key, token_type, token_value, description
        from team_design_tokens
        where team_id = $1
        order by token_type, token_key
      `,
      [membership.team_id],
    ),
    query(
      `
        select id, class_key, display_name, description, applies_to, style_json, text_style_json
        from team_style_classes
        where team_id = $1
        order by applies_to, display_name, class_key
      `,
      [membership.team_id],
    ),
  ]);

  return {
    organizationId: membership.organization_id,
    teamId: membership.team_id,
    tokens: tokenResult.rows.map((row) => ({
      id: row.id,
      key: row.token_key,
      type: row.token_type,
      value: row.token_value,
      description: row.description,
    })),
    styleClasses: classResult.rows.map((row) => ({
      id: row.id,
      key: row.class_key,
      displayName: row.display_name,
      description: row.description,
      appliesTo: row.applies_to,
      style: row.style_json || {},
      textStyle: row.text_style_json || {},
    })),
  };
}

export async function saveTeamDesignSystem(account, payload = {}) {
  const membership = primaryMembership(account);
  const tokens = Array.isArray(payload.tokens) ? payload.tokens.map(normalizeToken) : [];
  const styleClasses = Array.isArray(payload.styleClasses) ? payload.styleClasses.map(normalizeStyleClass) : [];
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    for (const token of tokens) {
      await client.query(
        `
          insert into team_design_tokens (
            organization_id,
            team_id,
            token_key,
            token_type,
            token_value,
            description,
            created_by,
            updated_by
          )
          values ($1, $2, $3, $4, $5, $6, $7, $7)
          on conflict (team_id, token_key)
          do update set
            token_type = excluded.token_type,
            token_value = excluded.token_value,
            description = excluded.description,
            updated_by = excluded.updated_by,
            updated_at = now()
        `,
        [membership.organization_id, membership.team_id, token.key, token.type, token.value, token.description, account.user.id],
      );
    }

    for (const styleClass of styleClasses) {
      await client.query(
        `
          insert into team_style_classes (
            organization_id,
            team_id,
            class_key,
            display_name,
            description,
            applies_to,
            style_json,
            text_style_json,
            created_by,
            updated_by
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
          on conflict (team_id, class_key)
          do update set
            display_name = excluded.display_name,
            description = excluded.description,
            applies_to = excluded.applies_to,
            style_json = excluded.style_json,
            text_style_json = excluded.text_style_json,
            updated_by = excluded.updated_by,
            updated_at = now()
        `,
        [
          membership.organization_id,
          membership.team_id,
          styleClass.key,
          styleClass.displayName,
          styleClass.description,
          styleClass.appliesTo,
          JSON.stringify(styleClass.style),
          JSON.stringify(styleClass.textStyle),
          account.user.id,
        ],
      );
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  return listTeamDesignSystem(account);
}
