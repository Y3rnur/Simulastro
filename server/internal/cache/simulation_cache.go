package cache

import (
	"sync"

	pb "github.com/yernur/astrophysics_simulation/server/proto"
)

// SimulationCache implements a thread-safe, high-performance circular ring buffer
type SimulationCache struct {
	mu          sync.RWMutex         // Protects concurrent read/write operations
	frames      []*pb.TelemetryFrame // fixed-size storage array for memory recycling
	maxSize     int                  // Maximum historical frame capacity
	writeIndex  int                  // Points to the next slot to overwrite
	totalFrames int64                // Counter of all frames passed through the system
}

// NewSimulationCache initializes flat memory allocation block for history tracking
func NewSimulationCache(maxSize int) *SimulationCache {
	return &SimulationCache{
		frames:  make([]*pb.TelemetryFrame, maxSize),
		maxSize: maxSize,
	}
}

// Push adds a new frame to the buffer, automatically overwriting the oldest entry
func (c *SimulationCache) Push(frame *pb.TelemetryFrame) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// write the frame pointer directly into the pre-allocated array slot
	c.frames[c.writeIndex] = frame

	// Advance the pointer or wrap around 0 using the modulo operator
	c.writeIndex = (c.writeIndex + 1) % c.maxSize
	c.totalFrames++
}

// GetHistory extracts all currently available frames in correct chronological order
func (c *SimulationCache) GetHistory() []*pb.TelemetryFrame {
	c.mu.RLock()
	defer c.mu.RUnlock()

	var history []*pb.TelemetryFrame

	// determine count of actual data
	count := c.maxSize
	if c.totalFrames < int64(c.maxSize) {
		count = int(c.totalFrames)
	}

	if count == 0 {
		return history
	}

	// reconstructing timeline from oldest active frame
	startIdx := 0
	if c.totalFrames >= int64(c.maxSize) {
		startIdx = c.writeIndex
	}

	for i := 0; i < count; i++ {
		currIdx := (startIdx + i) % c.maxSize
		if c.frames[currIdx] != nil {
			history = append(history, c.frames[currIdx])
		}
	}

	return history
}

// GetStats returns telemetry health parameters
func (c *SimulationCache) GetStats() (int64, int) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.totalFrames, c.writeIndex
}
