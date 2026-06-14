package calculator

import (
	"github.com/Vilsol/timeless-jewels/data"
	"github.com/Vilsol/timeless-jewels/random"
)

type UpdateFunc func(seed uint32)

// calculationCache is keyed by (conqueror, jewelType, realSeed, passiveIdx).
// The per-seed inner map is intentionally small (~60 entries) to keep
// each lookup hot in L1: a single 474k-entry flat map regressed cached-bench
// throughput by ~5× because the bucket array no longer fits in L2.
var calculationCache = make(map[data.Conqueror]map[data.JewelType]map[uint32]map[uint32]data.AlternatePassiveSkillInformation)

func Calculate(passiveID uint32, seed uint32, timelessJewelType data.JewelType, conqueror data.Conqueror) data.AlternatePassiveSkillInformation {
	passiveSkill := data.GetPassiveSkillByIndex(passiveID)

	if !data.IsPassiveSkillValidForAlteration(passiveSkill) {
		return data.AlternatePassiveSkillInformation{}
	}

	alternateTreeVersion := data.GetAlternateTreeVersionIndex(uint32(timelessJewelType))
	if alternateTreeVersion == nil {
		return data.AlternatePassiveSkillInformation{}
	}

	timelessJewelConqueror := data.TimelessJewelConquerors[timelessJewelType][conqueror]
	if timelessJewelConqueror == nil {
		return data.AlternatePassiveSkillInformation{}
	}

	timelessJewel := data.TimelessJewel{
		Seed:                   seed,
		AlternateTreeVersion:   alternateTreeVersion,
		TimelessJewelConqueror: timelessJewelConqueror,
	}

	alternateTreeManager := AlternateTreeManager{
		PassiveSkill:  passiveSkill,
		TimelessJewel: timelessJewel,
	}

	var rng random.NumberGenerator
	if alternateTreeManager.IsPassiveSkillReplaced(&rng) {
		return alternateTreeManager.ReplacePassiveSkill(&rng)
	}

	return data.AlternatePassiveSkillInformation{
		AlternatePassiveAdditionInformations: alternateTreeManager.AugmentPassiveSkill(&rng),
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
	if alternateTreeVersion == nil {
		return nil
	}

	timelessJewelConqueror := data.TimelessJewelConquerors[timelessJewelType][conqueror]
	if timelessJewelConqueror == nil {
		return nil
	}

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

	conquerorCache, ok := calculationCache[conqueror]
	if !ok {
		conquerorCache = make(map[data.JewelType]map[uint32]map[uint32]data.AlternatePassiveSkillInformation)
		calculationCache[conqueror] = conquerorCache
	}

	jewelCache, ok := conquerorCache[timelessJewelType]
	if !ok {
		jewelCache = make(map[uint32]map[uint32]data.AlternatePassiveSkillInformation)
		conquerorCache[timelessJewelType] = jewelCache
	}

	results := make(map[uint32]map[uint32]map[uint32]int32)

	var rng random.NumberGenerator
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

		seedCache, ok := jewelCache[realSeed]
		if !ok {
			seedCache = make(map[uint32]data.AlternatePassiveSkillInformation, len(passiveSkills))
			jewelCache[realSeed] = seedCache
		}

		for _, skill := range passiveSkills {
			alternateTreeManager.PassiveSkill = skill

			var result data.AlternatePassiveSkillInformation
			if cacheHit, ok := seedCache[skill.Index]; ok {
				result = cacheHit
			} else {
				if alternateTreeManager.IsPassiveSkillReplaced(&rng) {
					result = alternateTreeManager.ReplacePassiveSkill(&rng)
				} else {
					result = data.AlternatePassiveSkillInformation{
						AlternatePassiveAdditionInformations: alternateTreeManager.AugmentPassiveSkill(&rng),
					}
				}
				seedCache[skill.Index] = result
			}

			var skillResults map[uint32]int32

			if result.AlternatePassiveSkill != nil {
				for i, key := range result.AlternatePassiveSkill.StatsKeys {
					if _, ok := statMap[key]; ok {
						if skillResults == nil {
							seedResults := results[realSeed]
							if seedResults == nil {
								seedResults = make(map[uint32]map[uint32]int32)
								results[realSeed] = seedResults
							}
							if existing, ok := seedResults[skill.Index]; ok {
								skillResults = existing
							} else {
								skillResults = make(map[uint32]int32)
								seedResults[skill.Index] = skillResults
							}
						}
						skillResults[key] = result.StatRolls[i]
					}
				}
			}

			for _, augment := range result.AlternatePassiveAdditionInformations {
				if augment.AlternatePassiveAddition != nil {
					for i, key := range augment.AlternatePassiveAddition.StatsKeys {
						if _, ok := statMap[key]; ok {
							if skillResults == nil {
								seedResults := results[realSeed]
								if seedResults == nil {
									seedResults = make(map[uint32]map[uint32]int32)
									results[realSeed] = seedResults
								}
								if existing, ok := seedResults[skill.Index]; ok {
									skillResults = existing
								} else {
									skillResults = make(map[uint32]int32)
									seedResults[skill.Index] = skillResults
								}
							}
							skillResults[key] = augment.StatRolls[i]
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
	if alternateTreeVersion == nil {
		return nil
	}

	timelessJewelConqueror := data.TimelessJewelConquerors[timelessJewelType][conqueror]
	if timelessJewelConqueror == nil {
		return nil
	}

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

	var rng random.NumberGenerator
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

			if alternateTreeManager.IsPassiveSkillReplaced(&rng) {
				result = alternateTreeManager.ReplacePassiveSkill(&rng)
			} else {
				result = data.AlternatePassiveSkillInformation{
					AlternatePassiveAdditionInformations: alternateTreeManager.AugmentPassiveSkill(&rng),
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
							results[socketID][realSeed][skill.Index][key] = result.StatRolls[i]
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
								results[socketID][realSeed][skill.Index][key] = augment.StatRolls[i]
							}
						}
					}
				}
			}
		}
	}

	return results
}

func TargetedMarketSearch(passiveIDs []uint32, statIDs []uint32, timelessJewelType data.JewelType, seeds []uint32, conquerors []data.Conqueror, updates UpdateFunc) map[uint32]map[uint32]map[uint32]int32 {
	passiveSkills := make(map[uint32]*data.PassiveSkill)
	for _, id := range passiveIDs {
		skill := data.GetPassiveSkillByIndex(id)
		if data.IsPassiveSkillValidForAlteration(skill) {
			passiveSkills[id] = skill
		}
	}

	alternateTreeVersion := data.GetAlternateTreeVersionIndex(uint32(timelessJewelType))
	if alternateTreeVersion == nil {
		return nil
	}

	statMap := make(map[uint32]bool)
	for _, id := range statIDs {
		statMap[id] = true
	}

	results := make(map[uint32]map[uint32]map[uint32]int32)

	var rng random.NumberGenerator
	alternateTreeManager := AlternateTreeManager{}

	for i, seed := range seeds {
		conqueror := conquerors[i]

		realSeed := seed
		if data.TimelessJewelSeedRanges[timelessJewelType].Special {
			realSeed *= 20
		}

		if i%100 == 0 && updates != nil {
			updates(realSeed)
		}

		timelessJewelConqueror := data.TimelessJewelConquerors[timelessJewelType][conqueror]
		if timelessJewelConqueror == nil {
			continue
		}
		timelessJewel := data.TimelessJewel{
			AlternateTreeVersion:   alternateTreeVersion,
			TimelessJewelConqueror: timelessJewelConqueror,
			Seed:                   realSeed,
		}

		alternateTreeManager.TimelessJewel = timelessJewel

		for _, skill := range passiveSkills {
			alternateTreeManager.PassiveSkill = skill
			var result data.AlternatePassiveSkillInformation

			if alternateTreeManager.IsPassiveSkillReplaced(&rng) {
				result = alternateTreeManager.ReplacePassiveSkill(&rng)
			} else {
				result = data.AlternatePassiveSkillInformation{
					AlternatePassiveAdditionInformations: alternateTreeManager.AugmentPassiveSkill(&rng),
				}
			}

			if result.AlternatePassiveSkill != nil {
				for j, key := range result.AlternatePassiveSkill.StatsKeys {
					if _, ok := statMap[key]; ok {
						if _, ok := results[realSeed]; !ok {
							results[realSeed] = make(map[uint32]map[uint32]int32)
						}
						if _, ok := results[realSeed][skill.Index]; !ok {
							results[realSeed][skill.Index] = make(map[uint32]int32)
						}
						results[realSeed][skill.Index][key] = result.StatRolls[j]
					}
				}
			}

			for _, augment := range result.AlternatePassiveAdditionInformations {
				if augment.AlternatePassiveAddition != nil {
					for j, key := range augment.AlternatePassiveAddition.StatsKeys {
						if _, ok := statMap[key]; ok {
							if _, ok := results[realSeed]; !ok {
								results[realSeed] = make(map[uint32]map[uint32]int32)
							}
							if _, ok := results[realSeed][skill.Index]; !ok {
								results[realSeed][skill.Index] = make(map[uint32]int32)
							}
							results[realSeed][skill.Index][key] = augment.StatRolls[j]
						}
					}
				}
			}
		}
	}

	return results
}

func TargetedMassMarketSearch(scion map[uint32][]uint32, statIDs []uint32, timelessJewelType data.JewelType, seeds []uint32, conquerors []data.Conqueror, updates UpdateFunc) map[uint32]map[uint32]map[uint32]map[uint32]int32 {
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
	if alternateTreeVersion == nil {
		return nil
	}

	statMap := make(map[uint32]bool)
	for _, id := range statIDs {
		statMap[id] = true
	}

	results := make(map[uint32]map[uint32]map[uint32]map[uint32]int32)

	var rng random.NumberGenerator
	alternateTreeManager := AlternateTreeManager{}

	for i, seed := range seeds {
		conqueror := conquerors[i]

		realSeed := seed
		if data.TimelessJewelSeedRanges[timelessJewelType].Special {
			realSeed *= 20
		}

		if i%100 == 0 && updates != nil {
			updates(realSeed)
		}

		timelessJewelConqueror := data.TimelessJewelConquerors[timelessJewelType][conqueror]
		if timelessJewelConqueror == nil {
			continue
		}
		timelessJewel := data.TimelessJewel{
			AlternateTreeVersion:   alternateTreeVersion,
			TimelessJewelConqueror: timelessJewelConqueror,
			Seed:                   realSeed,
		}

		alternateTreeManager.TimelessJewel = timelessJewel

		for _, skill := range uniquePassives {
			alternateTreeManager.PassiveSkill = skill
			var result data.AlternatePassiveSkillInformation

			if alternateTreeManager.IsPassiveSkillReplaced(&rng) {
				result = alternateTreeManager.ReplacePassiveSkill(&rng)
			} else {
				result = data.AlternatePassiveSkillInformation{
					AlternatePassiveAdditionInformations: alternateTreeManager.AugmentPassiveSkill(&rng),
				}
			}

			if result.AlternatePassiveSkill != nil {
				for j, key := range result.AlternatePassiveSkill.StatsKeys {
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
							results[socketID][realSeed][skill.Index][key] = result.StatRolls[j]
						}
					}
				}
			}

			for _, augment := range result.AlternatePassiveAdditionInformations {
				if augment.AlternatePassiveAddition != nil {
					for j, key := range augment.AlternatePassiveAddition.StatsKeys {
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
								results[socketID][realSeed][skill.Index][key] = augment.StatRolls[j]
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
	calculationCache = make(map[data.Conqueror]map[data.JewelType]map[uint32]map[uint32]data.AlternatePassiveSkillInformation)
}
