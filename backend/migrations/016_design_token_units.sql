update team_design_tokens
set token_value = token_value || 'px'
where token_type in ('font-size', 'space', 'radius', 'border')
  and token_value ~ '^-?[0-9]+(\.[0-9]+)?$';
