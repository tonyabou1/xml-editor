alter table team_design_tokens
  drop constraint if exists team_design_tokens_token_type_check;

update team_design_tokens
set token_type = 'font-family'
where token_type = 'font';

update team_design_tokens
set token_type = 'font-size'
where token_type = 'typography';

alter table team_design_tokens
  add constraint team_design_tokens_token_type_check
  check (
    token_type in (
      'color',
      'space',
      'radius',
      'border',
      'shadow',
      'font-size',
      'font-family',
      'font-weight',
      'number',
      'asset'
    )
  );
