package calculator

import (
	"github.com/Vilsol/timeless-jewels/data"
	"github.com/Vilsol/timeless-jewels/random"
)

type UpdateFunc func(seed uint32)

func Calculate(passiveID uint32, seed uint32, timelessJewelType data.JewelType, conqueror data.Conqueror) data.AlternatePassiveSkillInformation {
	passiveSkill := data.GetPassiveSkillByIndex(passiveID)

	if !data.IsPassiveSkillValidForAlteration(passiveSkill) {
		return data.AlternatePassiveSkillInformation{}
	}

	alternateTreeVersion := data.GetAlternateTreeVersionIndex(uint32(timelessJewelType))

	timelessJewelConqueror := data.TimelessJewelConquerors[timelessJewelType][conqueror]

	timelessJewel := data.TimelessJewel{
		Seed:                   seed,
		AlternateTreeVersion:   alternateTreeVersion,
		TimelessJewelConqueror: timelessJewelConqueror,
	}

	alternateTreeManager := AlternateTreeManager{
		PassiveSkill:  passiveSkill,
		TimelessJewel: timelessJewel,
	}

	rng := random.NewRNG()
	if alternateTreeManager.IsPassiveSkillReplaced(rng) {
		return alternateTreeManager.ReplacePassiveSkill(rng)
	}

	return data.AlternatePassiveSkillInformation{
		AlternatePassiveAdditionInformations: alternateTreeManager.AugmentPassiveSkill(rng),
	}
}

func ReverseSearch(passiveIDs []uint32, statIDs []uint32, timelessJewelType data.JewelType, conqueror data.Conqueror, workerID uint32, numWorkers uint32, updates UpdateFunc) map[uint32]map[uint32]map[uint32]int32 {
	passiveSkills := make(map[uint32]*data.PassiveSkill)
	for _, id := range passiveIDs {
		skill := data.GetPassiveSkillByIndex(id)
		if data.IsPassiveSkillValidForAlteration(skill) {
			passiveSkills[id] = skill
		}
	}

	alternateTreeVersion := data.GetAlternateTreeVersionIndex(uint32(timelessJewelType))
	timelessJewelConqueror := data.TimelessJewelConquerors[timelessJewelType][conqueror]

	statMap := make(map[uint32]bool)
	for _, id := range statIDs {
		statMap[id] = true
	}

	seedMin := data.TimelessJewelSeedRanges[timelessJewelType].Min
	seedMax := data.TimelessJewelSeedRanges[timelessJewelType].Max

	if data.TimelessJewelSeedRanges[timelessJewelType].Special {
		seedMin /= 20
		seedMax /= 20
	}

	if numWorkers == 0 {
		numWorkers = 1
	}

	seedRange := seedMax - seedMin + 1
	chunkSize := seedRange / numWorkers

	startSeed := seedMin + workerID*chunkSize
	endSeed := startSeed + chunkSize - 1
	if workerID == numWorkers-1 {
		endSeed = seedMax
	}

	results := make(map[uint32]map[uint32]map[uint32]int32)

	rng := random.NewRNG()
	alternateTreeManager := AlternateTreeManager{}
	timelessJewel := data.TimelessJewel{
		AlternateTreeVersion:   alternateTreeVersion,
		TimelessJewelConqueror: timelessJewelConqueror,
	}

	for seed := startSeed; seed <= endSeed; seed++ {
		realSeed := seed
		if data.TimelessJewelSeedRanges[timelessJewelType].Special {
			realSeed *= 20
		}

		if seed%100 == 0 && updates != nil {
			updates(realSeed)
		}

		timelessJewel.Seed = realSeed
		alternateTreeManager.TimelessJewel = timelessJewel

		for _, skill := range passiveSkills {
			alternateTreeManager.PassiveSkill = skill
			var result data.AlternatePassiveSkillInformation

			if alternateTreeManager.IsPassiveSkillReplaced(rng) {
				result = alternateTreeManager.ReplacePassiveSkill(rng)
			} else {
				result = data.AlternatePassiveSkillInformation{
					AlternatePassiveAdditionInformations: alternateTreeManager.AugmentPassiveSkill(rng),
				}
			}

			if result.AlternatePassiveSkill != nil {
				for i, key := range result.AlternatePassiveSkill.StatsKeys {
					if _, ok := statMap[key]; ok {
						if _, ok := results[realSeed]; !ok {
							results[realSeed] = make(map[uint32]map[uint32]int32)
						}
						if _, ok := results[realSeed][skill.Index]; !ok {
							results[realSeed][skill.Index] = make(map[uint32]int32)
						}
						if result.StatRolls != nil {
							results[realSeed][skill.Index][key] = result.StatRolls[uint32(i)]
						}
					}
				}
			}

			for _, augment := range result.AlternatePassiveAdditionInformations {
				if augment.AlternatePassiveAddition != nil {
					for i, key := range augment.AlternatePassiveAddition.StatsKeys {
						if _, ok := statMap[key]; ok {
							if _, ok := results[realSeed]; !ok {
								results[realSeed] = make(map[uint32]map[uint32]int32)
							}
							if _, ok := results[realSeed][skill.Index]; !ok {
								results[realSeed][skill.Index] = make(map[uint32]int32)
							}
							if augment.StatRolls != nil {
								results[realSeed][skill.Index][key] = augment.StatRolls[uint32(i)]
							}
						}
					}
				}
			}
		}
	}

	return results
}

func MassReverseSearch(scion map[uint32][]uint32, statIDs []uint32, timelessJewelType data.JewelType, conqueror data.Conqueror, workerID uint32, numWorkers uint32, updates UpdateFunc) map[uint32]map[uint32]map[uint32]map[uint32]int32 {
	uniquePassives := make(map[uint32]*data.PassiveSkill)
	passiveToSockets := make(map[uint32][]uint32)

	for socketID, passives := range scion {
		for _, id := range passives {
			if _, ok := uniquePassives[id]; !ok {
				skill := data.GetPassiveSkillByIndex(id)
				if data.IsPassiveSkillValidForAlteration(skill) {
					uniquePassives[id] = skill
				}
			}
			if data.IsPassiveSkillValidForAlteration(uniquePassives[id]) {
				passiveToSockets[id] = append(passiveToSockets[id], socketID)
			}
		}
	}

	alternateTreeVersion := data.GetAlternateTreeVersionIndex(uint32(timelessJewelType))
	timelessJewelConqueror := data.TimelessJewelConquerors[timelessJewelType][conqueror]

	statMap := make(map[uint32]bool)
	for _, id := range statIDs {
		statMap[id] = true
	}

	seedMin := data.TimelessJewelSeedRanges[timelessJewelType].Min
	seedMax := data.TimelessJewelSeedRanges[timelessJewelType].Max

	if data.TimelessJewelSeedRanges[timelessJewelType].Special {
		seedMin /= 20
		seedMax /= 20
	}

	if numWorkers == 0 {
		numWorkers = 1
	}

	seedRange := seedMax - seedMin + 1
	chunkSize := seedRange / numWorkers

	startSeed := seedMin + workerID*chunkSize
	endSeed := startSeed + chunkSize - 1
	if workerID == numWorkers-1 {
		endSeed = seedMax
	}

	results := make(map[uint32]map[uint32]map[uint32]map[uint32]int32)

	rng := random.NewRNG()
	alternateTreeManager := AlternateTreeManager{}
	timelessJewel := data.TimelessJewel{
		AlternateTreeVersion:   alternateTreeVersion,
		TimelessJewelConqueror: timelessJewelConqueror,
	}

	for seed := startSeed; seed <= endSeed; seed++ {
		realSeed := seed
		if data.TimelessJewelSeedRanges[timelessJewelType].Special {
			realSeed *= 20
		}

		if seed%100 == 0 && updates != nil {
			updates(realSeed)
		}

		timelessJewel.Seed = realSeed
		alternateTreeManager.TimelessJewel = timelessJewel

		for _, skill := range uniquePassives {
			alternateTreeManager.PassiveSkill = skill
			var result data.AlternatePassiveSkillInformation

			if alternateTreeManager.IsPassiveSkillReplaced(rng) {
				result = alternateTreeManager.ReplacePassiveSkill(rng)
			} else {
				result = data.AlternatePassiveSkillInformation{
					AlternatePassiveAdditionInformations: alternateTreeManager.AugmentPassiveSkill(rng),
				}
			}

			if result.AlternatePassiveSkill != nil {
				for i, key := range result.AlternatePassiveSkill.StatsKeys {
					if _, ok := statMap[key]; ok {
						for _, socketID := range passiveToSockets[skill.Index] {
							if _, ok := results[socketID]; !ok {
								results[socketID] = make(map[uint32]map[uint32]map[uint32]int32)
							}
							if _, ok := results[socketID][realSeed]; !ok {
								results[socketID][realSeed] = make(map[uint32]map[uint32]int32)
							}
							if _, ok := results[socketID][realSeed][skill.Index]; !ok {
								results[socketID][realSeed][skill.Index] = make(map[uint32]int32)
							}
							if result.StatRolls != nil {
								results[socketID][realSeed][skill.Index][key] = result.StatRolls[uint32(i)]
							}
						}
					}
				}
			}

			for _, augment := range result.AlternatePassiveAdditionInformations {
				if augment.AlternatePassiveAddition != nil {
					for i, key := range augment.AlternatePassiveAddition.StatsKeys {
						if _, ok := statMap[key]; ok {
							for _, socketID := range passiveToSockets[skill.Index] {
								if _, ok := results[socketID]; !ok {
									results[socketID] = make(map[uint32]map[uint32]map[uint32]int32)
								}
								if _, ok := results[socketID][realSeed]; !ok {
									results[socketID][realSeed] = make(map[uint32]map[uint32]int32)
								}
								if _, ok := results[socketID][realSeed][skill.Index]; !ok {
									results[socketID][realSeed][skill.Index] = make(map[uint32]int32)
								}
								if augment.StatRolls != nil {
									results[socketID][realSeed][skill.Index][key] = augment.StatRolls[uint32(i)]
								}
							}
						}
					}
				}
			}
		}
	}

	return results
}

func ClearCache() {
}
