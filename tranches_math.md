1. Generic APR calculation for period T0..T1 (Target and Base)

```
Grows_Factor = ExchangeRate_T1 / ExchangeRate_T0 - 1
APR = Grows_Factor / (T1-T0) * 1Year
```

2. Senior APR calculation

```
TVL_ratio_sr = TVL_sr / (TVL_sr + TVL_jr)
Risk_Premium = x + y * TVL_ratio_sr ^ k

APR_sr_v1 = APRtarget
APR_sr_v2 = APRbase * (1 - Risk_Premium)

APR_sr = MAX(APR_sr_v1, APR_sr_v2)
```

3. Senior Gain calculation for period T0..T1

```
Interest_Factor = APR_sr * (T1-T0) / 1Year
Target_Index_T1 = Target_Index_T0 * (1 + Interest_Factor)


Senior_Gain = TVL_sr * (Target_Index_T1 / Target_Index_T0 - 1)
```
