import unittest

import pandas as pd

from backend import app


class MulticollinearityFixesTest(unittest.TestCase):
    def test_regression_plan_does_not_suggest_logistic(self):
        reading = [50, 55, 60, 55, 60, 65, 70, 65, 70, 75]
        df = pd.DataFrame(
            {
                "reading score": reading,
                "writing score": [value + 0.5 for value in reading],  # perfectly correlated with reading
                "math score": [55, 60, 58, 62, 66, 70, 68, 72, 76, 79],
            }
        )
        plan = app._build_preprocessing_plan(
            df,
            target="math score",
            features=["reading score", "writing score"],
            algorithms=["linear", "rf"],
        )
        multi_check = next(c for c in plan["validation_checks"] if c["key"] == "multicollinearity")
        labels = [fix["label"] for fix in multi_check["fixes"]]
        self.assertNotIn("Use Logistic Regression mindfully", labels)
        self.assertIn("Use tree-based regressors", labels)

    def test_classification_plan_allows_logistic_when_available(self):
        feature_a = [1, 2, 3, 2, 3, 4, 5, 4, 5, 6]
        df = pd.DataFrame(
            {
                "feature_a": feature_a,
                "feature_b": [value + 0.1 for value in feature_a],
                "feature_c": [value * 4 + 6 for value in feature_a],
                "passed": ["yes", "yes", "no", "no", "yes", "no", "yes", "no", "yes", "no"],
            }
        )
        plan = app._build_preprocessing_plan(
            df,
            target="passed",
            features=["feature_a", "feature_b", "feature_c"],
            algorithms=["logistic", "rf"],
        )
        multi_check = next(c for c in plan["validation_checks"] if c["key"] == "multicollinearity")
        labels = [fix["label"] for fix in multi_check["fixes"]]
        self.assertIn("Use Logistic Regression mindfully", labels)
        self.assertIn("Use tree-based classifiers", labels)


if __name__ == "__main__":
    unittest.main()
