package windowstate

type Transition uint8

const (
	Maximize Transition = iota + 1
	Restore
)

func Toggle(isMaximized bool) Transition {
	if isMaximized {
		return Restore
	}
	return Maximize
}
