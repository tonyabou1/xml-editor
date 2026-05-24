import { getPool } from "./db.mjs";

const bootstrapPermissions = [
  "organization.manage",
  "team.manage",
  "project.read",
  "project.write",
  "project.checkin",
  "schema.manage",
  "validation.run",
];

export async function syncAuthenticatedUser(identity) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const userCountResult = await client.query("select count(*)::int as count from app_users");
    const isFirstUser = userCountResult.rows[0].count === 0;
    const email = identity.email || `${identity.authSubject}@auth0.local`;
    const displayName = identity.displayName || email;

    const userResult = await client.query(
      `
        insert into app_users (auth_provider, auth_subject, email, display_name)
        values ($1, $2, $3, $4)
        on conflict (auth_provider, auth_subject)
        do update set
          email = excluded.email,
          display_name = excluded.display_name,
          updated_at = now()
        returning id, email, display_name, auth_provider, auth_subject, created_at, updated_at
      `,
      [identity.authProvider, identity.authSubject, email, displayName],
    );
    const user = userResult.rows[0];

    if (isFirstUser) {
      const organizationResult = await client.query(
        `
          insert into organizations (name, slug)
          values ('Default Organization', 'default')
          on conflict (slug)
          do update set name = excluded.name, updated_at = now()
          returning id, name, slug
        `,
      );
      const organization = organizationResult.rows[0];

      const teamResult = await client.query(
        `
          insert into teams (organization_id, name, slug)
          values ($1, 'Administrators', 'administrators')
          on conflict (organization_id, slug)
          do update set name = excluded.name, updated_at = now()
          returning id, name, slug
        `,
        [organization.id],
      );
      const team = teamResult.rows[0];

      const roleResult = await client.query(
        `
          insert into roles (organization_id, name, description, is_system)
          values ($1, 'Owner', 'Full administrative access for the organization.', true)
          on conflict (organization_id, name)
          do update set description = excluded.description, updated_at = now()
          returning id, name, description, is_system
        `,
        [organization.id],
      );
      const role = roleResult.rows[0];

      for (const permission of bootstrapPermissions) {
        await client.query(
          `
            insert into role_permissions (role_id, permission_key)
            values ($1, $2)
            on conflict do nothing
          `,
          [role.id, permission],
        );
      }

      await client.query(
        `
          insert into team_members (team_id, user_id, role_id)
          values ($1, $2, $3)
          on conflict (team_id, user_id)
          do update set role_id = excluded.role_id
        `,
        [team.id, user.id, role.id],
      );
    }

    const membershipsResult = await client.query(
      `
        select
          organizations.id as organization_id,
          organizations.name as organization_name,
          organizations.slug as organization_slug,
          teams.id as team_id,
          teams.name as team_name,
          teams.slug as team_slug,
          roles.id as role_id,
          roles.name as role_name,
          coalesce(
            json_agg(role_permissions.permission_key order by role_permissions.permission_key)
              filter (where role_permissions.permission_key is not null),
            '[]'::json
          ) as permissions
        from team_members
        join teams on teams.id = team_members.team_id
        join organizations on organizations.id = teams.organization_id
        left join roles on roles.id = team_members.role_id
        left join role_permissions on role_permissions.role_id = roles.id
        where team_members.user_id = $1
        group by organizations.id, teams.id, roles.id
        order by organizations.name, teams.name
      `,
      [user.id],
    );

    await client.query("commit");

    return {
      user,
      memberships: membershipsResult.rows,
      access: membershipsResult.rows.length ? "granted" : "pending",
      bootstrappedOwner: isFirstUser,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
