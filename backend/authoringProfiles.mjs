import { getPool, query } from "./db.mjs";

const xmlNamePattern = /^[A-Za-z_][A-Za-z0-9._-]*$/;

function primaryMembership(account) {
  const membership = account?.memberships?.[0];
  if (!membership?.organization_id || !membership?.team_id) {
    throw Object.assign(new Error("No team membership is available for Customize Types."), {
      statusCode: 403,
    });
  }
  return membership;
}

function normalizeDocumentType(value) {
  const documentType = String(value || "").trim();
  if (!xmlNamePattern.test(documentType)) {
    throw Object.assign(new Error("document_type must be a valid XML name."), { statusCode: 400 });
  }
  return documentType;
}

function normalizeProfile(profile = {}) {
  return {
    enabled: Boolean(profile.enabled),
    visibleElements: Array.isArray(profile.visibleElements)
      ? [...new Set(profile.visibleElements.map((item) => normalizeDocumentType(item)))].sort()
      : [],
  };
}

function normalizeProfilesMap(rawProfiles = {}) {
  if (!rawProfiles || typeof rawProfiles !== "object" || Array.isArray(rawProfiles)) {
    throw Object.assign(new Error("profiles must be an object keyed by document type."), { statusCode: 400 });
  }

  return Object.fromEntries(
    Object.entries(rawProfiles).map(([documentType, profile]) => [
      normalizeDocumentType(documentType),
      normalizeProfile(profile),
    ]),
  );
}

export async function listTeamAuthoringProfiles(account) {
  const membership = primaryMembership(account);
  const result = await query(
    `
      select document_type, profile_json
      from team_authoring_profiles
      where team_id = $1
      order by document_type
    `,
    [membership.team_id],
  );

  return {
    organizationId: membership.organization_id,
    teamId: membership.team_id,
    profiles: Object.fromEntries(result.rows.map((row) => [
      row.document_type,
      normalizeProfile(row.profile_json),
    ])),
  };
}

export async function saveTeamAuthoringProfiles(account, payload = {}) {
  const membership = primaryMembership(account);
  const profiles = normalizeProfilesMap(payload.profiles || {});
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    for (const [documentType, profile] of Object.entries(profiles)) {
      await client.query(
        `
          insert into team_authoring_profiles (
            organization_id,
            team_id,
            document_type,
            profile_json,
            created_by,
            updated_by
          )
          values ($1, $2, $3, $4, $5, $5)
          on conflict (team_id, document_type)
          do update set
            profile_json = excluded.profile_json,
            updated_by = excluded.updated_by,
            updated_at = now()
        `,
        [
          membership.organization_id,
          membership.team_id,
          documentType,
          JSON.stringify(profile),
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

  return listTeamAuthoringProfiles(account);
}
