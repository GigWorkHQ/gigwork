-- Sign-in messages name the site the user is on (any allowed frontend origin), so verification
-- must rebuild the message with the same domain and URI.
ALTER TABLE auth_nonces ADD COLUMN domain text;
ALTER TABLE auth_nonces ADD COLUMN uri text;
