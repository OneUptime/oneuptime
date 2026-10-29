package com.oneuptime.windowposture

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The report JavaScript reads, from what WindowManager says. The JavaScript
 * side (src/layout/windowPosture.test.ts) reads these same shapes.
 */
class FoldReportTest {
  @Test
  fun aGalaxyFoldHalfOpenLikeABookReportsItsFoldInPoints() {
    // 884 x 1104 points at 2.625: the fold runs top to bottom down the middle.
    val report = describeFolds(
      2320,
      2898,
      2.625f,
      listOf(FoldBounds(1160, 0, 1160, 2898, vertical = true, separating = true))
    )

    assertEquals(2320 / 2.625, report["windowWidth"] as Double, 0.0001)
    assertEquals(2898 / 2.625, report["windowHeight"] as Double, 0.0001)
    val folds = report["folds"] as List<*>
    assertEquals(1, folds.size)
    val fold = folds[0] as Map<*, *>
    assertEquals(1160 / 2.625, fold["x"] as Double, 0.0001)
    assertEquals(0.0, fold["y"] as Double, 0.0001)
    assertEquals(0.0, fold["width"] as Double, 0.0001)
    assertEquals(2898 / 2.625, fold["height"] as Double, 0.0001)
    assertEquals("vertical", fold["orientation"])
    assertEquals(true, fold["separating"])
  }

  @Test
  fun aFoldOnItsSideRunsHorizontally() {
    val report = describeFolds(
      2208,
      1768,
      2.0f,
      listOf(FoldBounds(0, 884, 2208, 884, vertical = false, separating = true))
    )

    val fold = (report["folds"] as List<*>)[0] as Map<*, *>
    assertEquals("horizontal", fold["orientation"])
    assertEquals(442.0, fold["y"] as Double, 0.0001)
    assertEquals(1104.0, fold["width"] as Double, 0.0001)
  }

  @Test
  fun aFoldLyingFlatDoesNotSplitTheWindow() {
    val report = describeFolds(
      1768,
      2208,
      2.0f,
      listOf(FoldBounds(884, 0, 884, 2208, vertical = true, separating = false))
    )

    val fold = (report["folds"] as List<*>)[0] as Map<*, *>
    assertEquals(false, fold["separating"])
  }

  @Test
  fun aHingeBetweenTwoScreensKeepsItsWidth() {
    val report = describeFolds(
      2784,
      1800,
      2.0f,
      listOf(FoldBounds(1350, 0, 1434, 1800, vertical = true, separating = true))
    )

    val fold = (report["folds"] as List<*>)[0] as Map<*, *>
    assertEquals(675.0, fold["x"] as Double, 0.0001)
    assertEquals(42.0, fold["width"] as Double, 0.0001)
  }

  @Test
  fun aWindowThatDoesNotFoldHasNoFolds() {
    val report = describeFolds(1080, 2400, 2.75f, emptyList())

    assertEquals(0, (report["folds"] as List<*>).size)
  }

  @Test
  fun bordersReportedBackwardsNeverMakeANegativeSize() {
    val report = describeFolds(
      1000,
      1000,
      1.0f,
      listOf(FoldBounds(600, 0, 500, 1000, vertical = true, separating = true))
    )

    val fold = (report["folds"] as List<*>)[0] as Map<*, *>
    assertEquals(0.0, fold["width"] as Double, 0.0001)
  }

  @Test
  fun anUnknownDensityReadsAsOnePixelAPoint() {
    val report = describeFolds(800, 600, 0f, emptyList())

    assertEquals(800.0, report["windowWidth"] as Double, 0.0001)
    assertEquals(600.0, report["windowHeight"] as Double, 0.0001)
  }
}
