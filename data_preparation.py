import pandas as pd
import numpy as np
import json
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA


def prepare_data():
    # 1. DATA LOADING
    df = pd.read_csv("../data/globalEconomyIndicators.csv")
    df.columns = df.columns.str.strip()

    # 2. CLEANING AND PREPARATION
    cols_needed = [
        "Country",
        "Year",
        "Population",
        "Gross Domestic Product (GDP)",
        "Agriculture, hunting, forestry, fishing (ISIC A-B)",
        "Manufacturing (ISIC D)",
        "Other Activities (ISIC J-P)",
        "Total Value Added",
    ]

    rename_map = {
        "Gross Domestic Product (GDP)": "GDP",
        "Agriculture, hunting, forestry, fishing (ISIC A-B)": "Agri",
        "Manufacturing (ISIC D)": "Manu",
        "Other Activities (ISIC J-P)": "Services",
        "Total Value Added": "TVA",
    }

    df_subset = df[cols_needed].rename(columns=rename_map)

    # Convert to numeric
    for col in ["GDP", "Agri", "Manu", "Services", "TVA", "Population"]:
        df_subset[col] = pd.to_numeric(df_subset[col], errors="coerce")

    # Filter years of interest
    df_filtered = df_subset[df_subset["Year"].isin([2000, 2021])].copy()

    # Pivot table to have 2000 and 2021 in the same row per country
    df_pivot = df_filtered.pivot(index="Country", columns="Year")
    df_pivot.columns = [f"{col}_{year}" for col, year in df_pivot.columns]
    df_pivot = df_pivot.reset_index()

    # 3. FILTERS AND CALCULATIONS
    # Filter: Population < 50 million in year 2000
    df_pivot = df_pivot[df_pivot["Population_2000"] < 50000000]

    # Remove nulls
    df_pivot = df_pivot.dropna()

    # Calculate GDP Growth (%)
    df_pivot["GDP_Growth_Pct"] = (
        (df_pivot["GDP_2021"] - df_pivot["GDP_2000"]) / df_pivot["GDP_2000"]
    ) * 100

    # Calculate Sector Shares (%)
    for year in ["2000", "2021"]:
        df_pivot[f"Share_Agri_{year}"] = (
            df_pivot[f"Agri_{year}"] / df_pivot[f"TVA_{year}"]
        ) * 100
        df_pivot[f"Share_Manu_{year}"] = (
            df_pivot[f"Manu_{year}"] / df_pivot[f"TVA_{year}"]
        ) * 100
        df_pivot[f"Share_Services_{year}"] = (
            df_pivot[f"Services_{year}"] / df_pivot[f"TVA_{year}"]
        ) * 100

    # Calculate STRUCTURAL CHANGE (Delta)
    df_pivot["Delta_Agri"] = df_pivot["Share_Agri_2021"] - df_pivot["Share_Agri_2000"]
    df_pivot["Delta_Manu"] = df_pivot["Share_Manu_2021"] - df_pivot["Share_Manu_2000"]
    df_pivot["Delta_Services"] = (
        df_pivot["Share_Services_2021"] - df_pivot["Share_Services_2000"]
    )

    # Select Top 50 growing countries
    top_growers = (
        df_pivot.sort_values(by="GDP_Growth_Pct", ascending=False).head(50).copy()
    )

    # 4. MODELING (CLUSTERING)
    features = ["Delta_Agri", "Delta_Manu", "Delta_Services"]
    X = top_growers[features]

    # Standardize data
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # K-Means with 3 Clusters
    kmeans = KMeans(n_clusters=3, random_state=42, n_init=10)
    top_growers["Cluster_ID"] = kmeans.fit_predict(X_scaled)

    # Characterize Clusters
    cluster_means = top_growers.groupby("Cluster_ID")[features].mean()

    def name_cluster(cid, row):
        if row["Delta_Services"] > 5 and row["Delta_Manu"] < 0:
            return "Service Expansion"
        elif row["Delta_Manu"] > 2:
            return "Industrial Growth"
        elif row["Delta_Agri"] < -5:
            return "Agri-Transition"
        else:
            return "Balanced Growth"

    cluster_map = {
        i: name_cluster(i, cluster_means.loc[i]) for i in cluster_means.index
    }
    top_growers["Cluster"] = top_growers["Cluster_ID"].map(cluster_map)

    # 5. PCA
    pca = PCA(n_components=2)
    coords = pca.fit_transform(X_scaled)
    top_growers["PC1"] = coords[:, 0]
    top_growers["PC2"] = coords[:, 1]

    # Get PCA loadings (how each feature contributes to PC1 and PC2)
    loadings = pca.components_.T * np.sqrt(pca.explained_variance_)
    loadings_data = []
    for i, feature in enumerate(features):
        loadings_data.append(
            {"feature": feature, "x": float(loadings[i, 0]), "y": float(loadings[i, 1])}
        )

    # 6. EXPORT
    output_cols = [
        "Country",
        "GDP_Growth_Pct",
        "Cluster",
        "Cluster_ID",
        "Delta_Agri",
        "Delta_Manu",
        "Delta_Services",
        "Share_Agri_2021",
        "Share_Manu_2021",
        "Share_Services_2021",
        "PC1",
        "PC2",
    ]

    # Also get the time series for these top 50 countries
    top_countries = top_growers["Country"].tolist()
    ts_data = df_subset[df_subset["Country"].isin(top_countries)].copy()
    ts_data = ts_data.sort_values(["Country", "Year"])

    # Nest yearly data into countries
    countries_data = []
    for country in top_countries:
        c_name = country.strip()
        c_row = top_growers[top_growers["Country"] == country].iloc[0]
        c_ts = ts_data[ts_data["Country"] == country]

        history = []
        for _, row in c_ts.iterrows():
            history.append({"year": int(row["Year"]), "gdp": float(row["GDP"])})

        countries_data.append(
            {
                "name": c_name,
                "gdp_growth": float(c_row["GDP_Growth_Pct"]),
                "cluster": c_row["Cluster"],
                "cluster_id": int(c_row["Cluster_ID"]),
                "delta_agri": float(c_row["Delta_Agri"]),
                "delta_manu": float(c_row["Delta_Manu"]),
                "delta_services": float(c_row["Delta_Services"]),
                "pc1": float(c_row["PC1"]),
                "pc2": float(c_row["PC2"]),
                "history": history,
            }
        )

    final_output = {"countries": countries_data, "loadings": loadings_data}

    with open("./dashboard_data.json", "w") as f:
        json.dump(final_output, f, indent=2)

    print("Data prepared and saved to data/dashboard_data.json")


if __name__ == "__main__":
    prepare_data()
