package cache

import (
	"log"
	"sync"
)

type SessionCacheManager struct {
	mu      sync.RWMutex
	caches  map[string]*SimulationCache
	maxSize int
}

func NewSessionCacheManager(maxSize int) *SessionCacheManager {
	return &SessionCacheManager{
		caches:  make(map[string]*SimulationCache),
		maxSize: maxSize,
	}
}

func (m *SessionCacheManager) GetOrCreate(sessionID string) *SimulationCache {
	m.mu.Lock()
	defer m.mu.Unlock()

	if cacheInstance, exists := m.caches[sessionID]; exists {
		return cacheInstance
	}

	// spin up a brand new isolated ring buffer for this specific session
	newCache := NewSimulationCache(m.maxSize)
	m.caches[sessionID] = newCache
	log.Printf("✨ Created new isolated SimulationCache for session: %s", sessionID)
	return newCache
}
