-- name: CreateScene :one
INSERT INTO scenes (id, user_id, name, is_public, created_at, updated_at)
VALUES ($1, $2, $3, $4, NOW(), NOW())
RETURNING id, user_id, name, is_public, created_at, updated_at;

-- name: InsertSceneBody :exec
INSERT INTO scene_bodies (id, scene_id, body_index, body_id, mass, radius, x, y, vx, vy, alive)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);

-- name: GetScenesByUserId :many
SELECT id, name, descriptions, created_at, updated_at
FROM scenes
WHERE user_id = $1
ORDER BY updated_at DESC;

-- name: GetSceneBodiesBySceneId :many
SELECT body_id, mass, radius, x, y, vx, vy
FROM scene_bodies
WHERE scene_id = $1;

-- name: DeleteScene :exec
DELETE FROM scenes WHERE id = $1;

-- name: UpdateSceneMetadata :exec
UPDATE scenes 
SET name = $1, descriptions = $2, updated_at = NOW()
WHERE id = $3 AND user_id = $4;