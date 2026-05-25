# SimuCast-Aligned ML Training and Validation Pipeline (R)
# This script implements the exact same pipeline as pipeline_comparison.py:
# 1. Listwise deletion of missing values.
# 2. Log1p transformation for skewed variables.
# 3. One-hot encoding for categorical variables (drop_first = TRUE).
# 4. Z-score scaling (StandardScaler equivalent).
# 5. 80:20 Train-Test split (stratified for classification).
# 6. Estimation and evaluation for 6 models (using base R, rpart, randomForest).
# 7. 5-Fold Cross-Validation (KFold / StratifiedKFold equivalents).

# Required Packages (Install if missing):
# install.packages(c("rpart", "randomForest"))

library(rpart)
library(randomForest)

# Helper function to compute skewness matching scipy.stats/pandas
skewness <- function(x) {
  n <- length(x)
  if (n < 3) return(0)
  m3 <- sum((x - mean(x))^3) / n
  s3 <- (sum((x - mean(x))^2) / (n - 1))^1.5
  return(m3 / s3)
}

# Helper function to compute weighted classification metrics
weighted_metrics <- function(y_true, y_pred) {
  classes <- unique(y_true)
  weights <- table(y_true) / length(y_true)
  
  precision <- 0
  recall <- 0
  f1 <- 0
  
  for (cls in classes) {
    tp <- sum(y_true == cls & y_pred == cls)
    fp <- sum(y_true != cls & y_pred == cls)
    fn <- sum(y_true == cls & y_pred != cls)
    
    p <- if (tp + fp > 0) tp / (tp + fp) else 0
    r <- if (tp + fn > 0) tp / (tp + fn) else 0
    f <- if (p + r > 0) 2 * (p * r) / (p + r) else 0
    
    w <- weights[as.character(cls)]
    precision <- precision + p * w
    recall <- recall + r * w
    f1 <- f1 + f * w
  }
  
  list(precision = as.numeric(precision), recall = as.numeric(recall), f1 = as.numeric(f1))
}

# Main pipeline function
run_pipeline <- function(data_path, target_col, task) {
  # Load dataset
  df <- read.csv(data_path, stringsAsFactors = FALSE)
  
  # 1. Listwise Deletion of missing values
  initial_rows <- nrow(df)
  df_clean <- na.omit(df)
  cat(sprintf("Listwise deletion: dropped %d rows. Remaining: %d\n", initial_rows - nrow(df_clean), nrow(df_clean)))
  
  # Identify numeric and categorical columns
  all_cols <- colnames(df_clean)
  feature_cols <- all_cols[all_cols != target_col]
  
  numeric_cols <- c()
  categorical_cols <- c()
  
  for (col in feature_cols) {
    if (is.numeric(df_clean[[col]])) {
      numeric_cols <- c(numeric_cols, col)
    } else {
      categorical_cols <- c(categorical_cols, col)
    }
  }
  
  # 2. Preprocess Skewed Numeric Columns (Skew >= 1.0)
  for (col in numeric_cols) {
    skew_val <- skewness(df_clean[[col]])
    if (abs(skew_val) >= 1.0) {
      min_val <- min(df_clean[[col]])
      shift <- if (min_val <= -1) abs(min_val) + 1.0 else 0.0
      df_clean[[col]] <- log1p(df_clean[[col]] + shift)
      cat(sprintf("Log1p transformed skewed column: '%s' (skew=%.3f)\n", col, skew_val))
    }
  }
  
  # 3. Categorical Variables One-Hot Encoding (drop_first=True)
  X_encoded <- df_clean[, numeric_cols, drop = FALSE]
  for (col in categorical_cols) {
    levels_val <- sort(unique(df_clean[[col]]))
    if (length(levels_val) > 1) {
      # Drop the first level to match Python's drop_first=True
      for (i in 2:length(levels_val)) {
        dummy_name <- paste0(col, "=", levels_val[i])
        X_encoded[[dummy_name]] <- as.numeric(df_clean[[col]] == levels_val[i])
      }
    }
  }
  
  # Target Encoding
  y <- df_clean[[target_col]]
  if (task == "classification") {
    classes <- sort(unique(y))
    positive_class <- classes[length(classes)] # Match python's target[-1] default
    y <- as.numeric(y == positive_class)
    cat(sprintf("Target classification encoded: positive class is '%s'\n", positive_class))
  }
  
  # 4. Z-score Scaling
  X_scaled <- as.data.frame(scale(X_encoded))
  
  # 5. Train-Test Split (80:20 stratified split for classification, standard split for regression)
  set.seed(42)
  if (task == "classification") {
    train_idx <- c()
    for (cls in unique(y)) {
      cls_idx <- which(y == cls)
      train_cls <- sample(cls_idx, size = round(0.8 * length(cls_idx)))
      train_idx <- c(train_idx, train_cls)
    }
  } else {
    train_idx <- sample(1:nrow(X_scaled), size = round(0.8 * nrow(X_scaled)))
  }
  
  X_train <- X_scaled[train_idx, , drop = FALSE]
  X_test <- X_scaled[-train_idx, , drop = FALSE]
  y_train <- y[train_idx]
  y_test <- y[-train_idx]
  
  cat(sprintf("Train set: %d rows | Test set: %d rows\n", nrow(X_train), nrow(X_test)))
  
  results <- list()
  
  if (task == "regression") {
    # Linear Regression
    fit_lr <- lm(y_train ~ ., data = cbind(X_train, y_train = y_train))
    pred_lr <- predict(fit_lr, newdata = X_test)
    
    # Decision Tree Regressor (rpart)
    # cp = 0 and minsplit = 2 matches sklearn defaults
    fit_dt <- rpart(y_train ~ ., data = cbind(X_train, y_train = y_train), 
                    control = rpart.control(cp = 0, minsplit = 2, minbucket = 1))
    pred_dt <- predict(fit_dt, newdata = X_test)
    
    # Random Forest Regressor
    fit_rf <- randomForest(X_train, y_train, ntree = 100)
    pred_rf <- predict(fit_rf, newdata = X_test)
    
    regression_eval <- function(y_true, y_pred, model_name, X_full, y_full) {
      mae <- mean(abs(y_true - y_pred))
      rmse <- sqrt(mean((y_true - y_pred)^2))
      ss_res <- sum((y_true - y_pred)^2)
      ss_tot <- sum((y_true - mean(y_true))^2)
      r2 <- 1 - (ss_res / ss_tot)
      
      # 5-fold Cross-Validation
      set.seed(42)
      folds <- sample(rep(1:5, length.out = nrow(X_full)))
      cv_r2 <- c()
      
      for (f in 1:5) {
        val_idx <- which(folds == f)
        X_tr <- X_full[-val_idx, , drop = FALSE]
        y_tr <- y_full[-val_idx]
        X_va <- X_full[val_idx, , drop = FALSE]
        y_va <- y_full[val_idx]
        
        if (model_name == "Linear Regression") {
          cv_model <- lm(y_tr ~ ., data = cbind(X_tr, y_train = y_tr))
          cv_pred <- predict(cv_model, newdata = X_va)
        } else if (model_name == "Decision Tree Regressor") {
          cv_model <- rpart(y_tr ~ ., data = cbind(X_tr, y_train = y_tr), 
                            control = rpart.control(cp = 0, minsplit = 2, minbucket = 1))
          cv_pred <- predict(cv_model, newdata = X_va)
        } else {
          cv_model <- randomForest(X_tr, y_tr, ntree = 100)
          cv_pred <- predict(cv_model, newdata = X_va)
        }
        
        cv_ss_res <- sum((y_va - cv_pred)^2)
        cv_ss_tot <- sum((y_va - mean(y_va))^2)
        cv_r2 <- c(cv_r2, 1 - (cv_ss_res / cv_ss_tot))
      }
      
      list(
        "Holdout MAE" = mae,
        "Holdout RMSE" = rmse,
        "Holdout R2" = r2,
        "CV Mean R2" = mean(cv_r2),
        "CV SD R2" = sd(cv_r2)
      )
    }
    
    results[["Linear Regression"]] <- regression_eval(y_test, pred_lr, "Linear Regression", X_scaled, y)
    results[["Decision Tree Regressor"]] <- regression_eval(y_test, pred_dt, "Decision Tree Regressor", X_scaled, y)
    results[["Random Forest Regressor"]] <- regression_eval(y_test, pred_rf, "Random Forest Regressor", X_scaled, y)
    
  } else if (task == "classification") {
    # Logistic Regression
    fit_log <- glm(y_train ~ ., data = cbind(X_train, y_train = y_train), family = binomial)
    prob_log <- predict(fit_log, newdata = X_test, type = "response")
    pred_log <- as.numeric(prob_log >= 0.5)
    
    # Decision Tree Classifier (rpart)
    fit_dt <- rpart(y_train ~ ., data = cbind(X_train, y_train = as.factor(y_train)), method = "class",
                    control = rpart.control(cp = 0, minsplit = 2, minbucket = 1))
    pred_dt <- as.numeric(as.character(predict(fit_dt, newdata = X_test, type = "class")))
    
    # Random Forest Classifier
    fit_rf <- randomForest(X_train, as.factor(y_train), ntree = 100)
    pred_rf <- as.numeric(as.character(predict(fit_rf, newdata = X_test)))
    
    classification_eval <- function(y_true, y_pred, model_name, X_full, y_full) {
      acc <- mean(y_true == y_pred)
      wm <- weighted_metrics(y_true, y_pred)
      
      # 5-fold Stratified Cross-Validation
      set.seed(42)
      folds <- rep(0, length(y_full))
      for (cls in unique(y_full)) {
        cls_idx <- which(y_full == cls)
        folds[cls_idx] <- sample(rep(1:5, length.out = length(cls_idx)))
      }
      
      cv_acc <- c()
      
      for (f in 1:5) {
        val_idx <- which(folds == f)
        X_tr <- X_full[-val_idx, , drop = FALSE]
        y_tr <- y_full[-val_idx]
        X_va <- X_full[val_idx, , drop = FALSE]
        y_va <- y_full[val_idx]
        
        if (model_name == "Logistic Regression") {
          cv_model <- glm(y_tr ~ ., data = cbind(X_tr, y_train = y_tr), family = binomial)
          cv_prob <- predict(cv_model, newdata = X_va, type = "response")
          cv_pred <- as.numeric(cv_prob >= 0.5)
        } else if (model_name == "Decision Tree Classifier") {
          cv_model <- rpart(y_tr ~ ., data = cbind(X_tr, y_train = as.factor(y_tr)), method = "class",
                            control = rpart.control(cp = 0, minsplit = 2, minbucket = 1))
          cv_pred <- as.numeric(as.character(predict(cv_model, newdata = X_va, type = "class")))
        } else {
          cv_model <- randomForest(X_tr, as.factor(y_tr), ntree = 100)
          cv_pred <- as.numeric(as.character(predict(cv_model, newdata = X_va)))
        }
        
        cv_acc <- c(cv_acc, mean(y_va == cv_pred))
      }
      
      list(
        "Holdout Accuracy" = acc,
        "Holdout Precision" = wm$precision,
        "Holdout Recall" = wm$recall,
        "Holdout F1" = wm$f1,
        "CV Mean Accuracy" = mean(cv_acc),
        "CV SD Accuracy" = sd(cv_acc)
      )
    }
    
    results[["Logistic Regression"]] <- classification_eval(y_test, pred_log, "Logistic Regression", X_scaled, y)
    results[["Decision Tree Classifier"]] <- classification_eval(y_test, pred_dt, "Decision Tree Classifier", X_scaled, y)
    results[["Random Forest Classifier"]] <- classification_eval(y_test, pred_rf, "Random Forest Classifier", X_scaled, y)
  }
  
  # Print Results
  for (model_name in names(results)) {
    cat(sprintf("\n--- %s ---\n", model_name))
    metrics <- results[[model_name]]
    for (metric_name in names(metrics)) {
      cat(sprintf("%s: %.4f\n", metric_name, metrics[[metric_name]]))
    }
  }
  
  return(results)
}

# Example of how to execute:
# csv_files <- list.files(pattern = "\\.csv$")
# if (length(csv_files) > 0) {
#   run_pipeline(csv_files[1], "Will_Graduate", "classification")
# } else {
#   cat("No CSV files found in the current directory.\n")
# }
