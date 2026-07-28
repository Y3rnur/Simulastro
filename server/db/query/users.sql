-- name: CreateUser :one
INSERT INTO users(email, password_hash, display_name)
VALUES ($1, $2, $3)
RETURNING id, email, password_hash, display_name, created_at, updated_at;

-- name: GetUserByEmail :one
SELECT id, email, password_hash, display_name, created_at, updated_at, deleted_at
FROM users
WHERE email = $1 AND deleted_at IS NULL;