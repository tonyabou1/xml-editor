import { query } from "./db.mjs";

const allowedSeverities = new Set(["info", "warning", "error"]);
const maxNotifications = 10;

export async function listUserNotifications(userId) {
  const result = await query(
    `
      select
        id,
        severity,
        title,
        body,
        source,
        created_at,
        dismissed_at
      from user_notifications
      where user_id = $1
      order by created_at desc
      limit $2
    `,
    [userId, maxNotifications],
  );

  return {
    notifications: result.rows.map(toApiNotification),
    limit: maxNotifications,
  };
}

export async function createUserNotification(userId, notification) {
  const severity = allowedSeverities.has(notification.severity) ? notification.severity : "info";
  const title = String(notification.title || "").trim();
  const body = String(notification.body || "").trim();
  const source = String(notification.source || "").trim() || null;

  if (!title || !body) {
    throw Object.assign(new Error("Notification title and body are required."), { statusCode: 400 });
  }

  const membership = await getPrimaryMembership(userId);
  const result = await query(
    `
      insert into user_notifications (
        user_id,
        organization_id,
        team_id,
        severity,
        title,
        body,
        source
      )
      values ($1, $2, $3, $4, $5, $6, $7)
      returning
        id,
        severity,
        title,
        body,
        source,
        created_at,
        dismissed_at
    `,
    [
      userId,
      membership?.organization_id || null,
      membership?.team_id || null,
      severity,
      title.slice(0, 180),
      body.slice(0, 2000),
      source?.slice(0, 240) || null,
    ],
  );

  await query(
    `
      delete from user_notifications
      where user_id = $1
        and id not in (
          select id
          from user_notifications
          where user_id = $1
          order by created_at desc
          limit $2
        )
    `,
    [userId, maxNotifications],
  );

  return {
    notification: toApiNotification(result.rows[0]),
    limit: maxNotifications,
  };
}

export async function clearUserNotifications(userId) {
  await query("delete from user_notifications where user_id = $1", [userId]);
  return {
    ok: true,
    notifications: [],
    limit: maxNotifications,
  };
}

async function getPrimaryMembership(userId) {
  const result = await query(
    `
      select
        teams.organization_id,
        team_members.team_id
      from team_members
      join teams on teams.id = team_members.team_id
      where team_members.user_id = $1
      order by team_members.created_at asc
      limit 1
    `,
    [userId],
  );

  return result.rows[0] || null;
}

function toApiNotification(row) {
  return {
    id: row.id,
    severity: row.severity,
    title: row.title,
    body: row.body,
    source: row.source || "",
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    dismissedAt: row.dismissed_at instanceof Date ? row.dismissed_at.toISOString() : row.dismissed_at,
  };
}
